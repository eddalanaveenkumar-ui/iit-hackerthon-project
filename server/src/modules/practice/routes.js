import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../../utils/errors.js';
import { validate, round } from '../../utils/validation.js';
import { requireClassroomMember, requireClassroomStaff, toOid } from '../classrooms/access.js';
import { isFeatureEnabled } from '../ai/config-store.js';
import { runJsonTask } from '../ai/orchestrator.js';
import { prompts } from '../ai/prompts.js';
import { executeCode, staticCheck, codeSimilarity } from '../../utils/sandbox.js';
import { getOrCreateProfile, refreshProfileAggregates, applyMasteryEvidence } from '../intelligence/profile.js';
import { recordGap } from '../intelligence/gap-engine.js';

const router = Router();

/** Generate a practical exercise for a concept (student or teacher initiated). */
router.post(
  '/classrooms/:classroomId/exercises',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        conceptId: z.string(),
        language: z.enum(['javascript', 'python', 'java', 'sql']).default('javascript'),
        difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
      }),
      req.body,
    );
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    if (classroom.settings?.practicalEnabled === false) throw forbidden('Practical exercises are disabled for this classroom');
    if (!(await isFeatureEnabled('assessment_generation'))) throw forbidden('Exercise generation is disabled');

    const db = getDb();
    const concept = await db.collection('syllabus_units').findOne({
      _id: toOid(data.conceptId),
      classroomId: classroom._id,
      type: 'concept',
    });
    if (!concept) throw notFound('Concept not found in this classroom');

    const { data: generated, meta } = await runJsonTask('assessment_generation', {
      messages: prompts.exercise({ concept, language: data.language, difficulty: data.difficulty }),
      meta: { task: 'exercise_generation', concept, language: data.language, difficulty: data.difficulty },
      feature: 'assessment_generation',
      userId: req.userId,
      classroomId: classroom._id,
    });

    const g = generated && typeof generated === 'object' ? generated : {};
    const tests = (Array.isArray(g.tests) ? g.tests : []).slice(0, 8).map((t, i) => ({
      id: t.id || `t${i + 1}`,
      name: String(t.name || `Test ${i + 1}`).slice(0, 120),
      args: Array.isArray(t.args) ? t.args.map((a) => String(a)).slice(0, 4) : [],
      expected: t.expected === undefined ? 'any' : String(t.expected),
      hidden: Boolean(t.hidden),
    }));
    const doc = {
      classroomId: classroom._id,
      conceptId: concept._id,
      createdByUserId: req.userId,
      title: String(g.title || `Practice: ${concept.name}`).slice(0, 160),
      prompt: String(g.prompt || `Implement a solution that demonstrates ${concept.name}.`).slice(0, 2000),
      language: ['javascript', 'python', 'java', 'sql'].includes(g.language) ? g.language : data.language,
      starterCode: String(g.starterCode || '').slice(0, 4000),
      solutionHint: String(g.solutionHint || '').slice(0, 2000),
      tests: tests.length ? tests : [{ id: 't1', name: 'runs without error', args: [], expected: 'any', hidden: false }],
      rubric: (Array.isArray(g.rubric) ? g.rubric : [{ criterion: 'Correct behaviour', weight: 1 }]).slice(0, 6),
      difficulty: ['easy', 'medium', 'hard'].includes(g.difficulty) ? g.difficulty : data.difficulty,
      createdBy: 'ai',
      aiMeta: { provider: meta.provider, model: meta.model },
      createdAt: new Date(),
    };
    const { insertedId } = await db.collection('practical_exercises').insertOne(doc);
    const attempts = await db.collection('code_submissions').countDocuments({ exerciseId: insertedId, userId: req.userId });

    res.status(201).json({
      exercise: {
        id: String(insertedId),
        title: doc.title,
        prompt: doc.prompt,
        language: doc.language,
        starterCode: doc.starterCode,
        difficulty: doc.difficulty,
        rubric: doc.rubric,
        tests: doc.tests.filter((t) => !t.hidden).map((t) => ({ id: t.id, name: t.name, args: t.args, expected: t.expected })),
        hiddenTestCount: doc.tests.filter((t) => t.hidden).length,
        concept: { id: String(concept._id), name: concept.name },
        attempts,
      },
      ai: { provider: meta.provider, model: meta.model, simulated: Boolean(meta.simulated) },
    });
  }),
);

/** Run code without grading (the "Run" button in Monaco). */
router.post(
  '/classrooms/:classroomId/exercises/:exerciseId/run',
  asyncHandler(async (req, res) => {
    const data = validate(z.object({ code: z.string().max(60_000) }), req.body);
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const exercise = await db.collection('practical_exercises').findOne({
      _id: toOid(req.params.exerciseId),
      classroomId: classroom._id,
    });
    if (!exercise) throw notFound('Exercise not found');
    const outcome = await executeCode({
      code: data.code,
      language: exercise.language,
      tests: exercise.tests.filter((t) => !t.hidden),
    });
    res.json({
      executed: outcome.executed,
      runtime: outcome.runtime,
      reason: outcome.reason || null,
      results: outcome.results,
      stdout: outcome.stdout,
      loadError: outcome.loadError,
      timedOut: outcome.timedOut,
      staticAnalysis: outcome.staticAnalysis,
    });
  }),
);

/**
 * Submit attempt -> sandboxed execution of ALL tests (including hidden ones)
 * -> AI code review -> repeated-mistake tracking + copy detection -> profile.
 */
router.post(
  '/classrooms/:classroomId/exercises/:exerciseId/submit',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        code: z.string().min(1).max(60_000),
        hintsUsed: z.number().int().min(0).max(20).optional(),
        timeSpentSeconds: z.number().int().min(0).max(36_000).optional(),
      }),
      req.body,
    );
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const exercise = await db.collection('practical_exercises').findOne({
      _id: toOid(req.params.exerciseId),
      classroomId: classroom._id,
    });
    if (!exercise) throw notFound('Exercise not found');

    const concept = await db.collection('syllabus_units').findOne({ _id: exercise.conceptId });
    const previousAttempts = await db
      .collection('code_submissions')
      .find({ exerciseId: exercise._id, userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();
    const attempt = previousAttempts.length + 1;

    const outcome = await executeCode({ code: data.code, language: exercise.language, tests: exercise.tests });
    const visibleResults = outcome.results.filter((r) => !exercise.tests.find((t) => t.id === r.id)?.hidden);
    const passedAll = outcome.results.length > 0 && outcome.results.every((r) => r.passed);
    const passedCount = outcome.results.filter((r) => r.passed).length;
    const similarity = codeSimilarity(data.code, exercise.solutionHint || exercise.starterCode);
    const copyPasteSuspected = similarity > 85 && data.code.length > 120;

    // Repeated-error detection: did the same test fail in earlier attempts?
    const previouslyFailed = new Set();
    previousAttempts.forEach((p) => {
      (p.testResults || []).filter((t) => !t.passed).forEach((t) => previouslyFailed.add(t.id));
    });
    const stillFailing = outcome.results.filter((r) => !r.passed && previouslyFailed.has(r.id));

    let codeReview = null;
    if (await isFeatureEnabled('code_analysis')) {
      const { data: review } = await runJsonTask('code_analysis', {
        messages: prompts.code({
          exercise: { title: exercise.title, prompt: exercise.prompt, language: exercise.language, rubric: exercise.rubric },
          code: data.code,
          runSummary: JSON.stringify(
            { executed: outcome.executed, runtime: outcome.runtime, results: outcome.results, loadError: outcome.loadError, static: outcome.staticAnalysis },
            null,
            2,
          ),
        }),
        meta: { task: 'code_analysis', code: data.code, exercise: { language: exercise.language, starterCode: exercise.starterCode, solutionHint: exercise.solutionHint } },
        feature: 'code_analysis',
        userId: req.userId,
        classroomId: classroom._id,
      });
      codeReview = review && typeof review === 'object' ? review : null;
    }

    const submissionDoc = {
      exerciseId: exercise._id,
      userId: req.userId,
      classroomId: classroom._id,
      conceptId: exercise.conceptId,
      code: data.code,
      language: exercise.language,
      attempt,
      passed: passedAll,
      testResults: outcome.results,
      executed: outcome.executed,
      runtime: outcome.runtime,
      staticAnalysis: {
        ...outcome.staticAnalysis,
        similarityToSolution: similarity,
        copyPasteSuspected,
        conceptsUnderstood: codeReview?.conceptsUnderstood || [],
        understandingVerdict: codeReview?.understandingVerdict || null,
      },
      hintsUsed: data.hintsUsed || 0,
      timeSpentSeconds: data.timeSpentSeconds || 0,
      createdAt: new Date(),
    };
    const { insertedId } = await db.collection('code_submissions').insertOne(submissionDoc);

    // Evidence -> mastery + weaknesses
    await applyMasteryEvidence({
      userId: req.userId,
      classroomId: classroom._id,
      conceptId: exercise.conceptId,
      unitId: concept?.parentId,
      subjectId: concept?.subjectId,
      correct: passedAll && !copyPasteSuspected,
      hinted: (data.hintsUsed || 0) > 0,
      source: 'practical',
    });

    const recordedGaps = [];
    if (stillFailing.length) {
      recordedGaps.push(
        await recordGap({
          userId: req.userId,
          classroomId: classroom._id,
          subjectId: concept?.subjectId,
          unitId: concept?.parentId,
          conceptId: exercise.conceptId,
          category: 'repeated_error',
          description: `Repeats the same failing behaviour on "${exercise.title}" (${stillFailing.map((r) => r.id).join(', ')}).`,
          evidence: `Attempt ${attempt}: ${stillFailing.map((r) => r.error || r.output).join(' | ')}`,
          severity: 'high',
          confidence: 0.88,
          detectedBy: 'practical',
          evidenceRef: insertedId,
          evidenceType: 'code',
        }),
      );
    }
    for (const issue of (outcome.staticAnalysis?.issues || []).filter((i) => i.type === 'logic')) {
      recordedGaps.push(
        await recordGap({
          userId: req.userId,
          classroomId: classroom._id,
          subjectId: concept?.subjectId,
          unitId: concept?.parentId,
          conceptId: exercise.conceptId,
          category: 'practical_difficulty',
          description: issue.message,
          evidence: data.code.slice(0, 400),
          severity: 'medium',
          confidence: 0.72,
          detectedBy: 'rule_engine',
          evidenceRef: insertedId,
          evidenceType: 'code',
        }),
      );
    }
    if (copyPasteSuspected) {
      recordedGaps.push(
        await recordGap({
          userId: req.userId,
          classroomId: classroom._id,
          subjectId: concept?.subjectId,
          unitId: concept?.parentId,
          conceptId: exercise.conceptId,
          category: 'knowledge_gap',
          description: `Submitted code is ${similarity}% similar to the reference solution — conceptual understanding is unverified.`,
          evidence: 'Copy-paste detection',
          severity: 'medium',
          confidence: 0.66,
          detectedBy: 'rule_engine',
          evidenceRef: insertedId,
          evidenceType: 'code',
        }),
      );
    }

    const profile = await getOrCreateProfile(req.userId, classroom._id);
    const updated = await refreshProfileAggregates(req.userId, classroom._id, {
      stats: {
        ...profile.stats,
        practicalSolved: (profile.stats.practicalSolved || 0) + (passedAll ? 1 : 0),
        totalStudyMinutes: (profile.stats.totalStudyMinutes || 0) + Math.round((data.timeSpentSeconds || 0) / 60),
      },
    });
    await db.collection('student_activities').insertOne({
      userId: req.userId,
      classroomId: classroom._id,
      type: 'practical_attempted',
      title: `${passedAll ? 'Solved' : 'Attempted'} "${exercise.title}" (attempt ${attempt})`,
      meta: { exerciseId: String(exercise._id), passedCount, total: outcome.results.length, attempt },
      conceptId: exercise.conceptId,
      minutes: Math.round((data.timeSpentSeconds || 0) / 60),
      createdAt: new Date(),
    });

    res.status(201).json({
      submission: {
        id: String(insertedId),
        attempt,
        passed: passedAll,
        passedCount,
        totalTests: outcome.results.length,
        executed: outcome.executed,
        runtime: outcome.runtime,
        reason: outcome.reason || null,
        timedOut: outcome.timedOut,
        loadError: outcome.loadError,
        results: visibleResults.map((r) => ({ id: r.id, passed: r.passed, output: r.output, error: r.error })),
        hiddenSummary: exercise.tests.filter((t) => t.hidden).map((t) => {
          const r = outcome.results.find((x) => x.id === t.id);
          return { id: t.id, passed: Boolean(r?.passed) };
        }),
        staticAnalysis: submissionDoc.staticAnalysis,
        repeatedMistakes: stillFailing.map((r) => r.id),
        similarity: round(similarity, 1),
      },
      review: codeReview
        ? {
            syntaxErrors: codeReview.syntaxErrors || [],
            logicWarnings: codeReview.logicWarnings || [],
            conceptsUnderstood: codeReview.conceptsUnderstood || [],
            understandingVerdict: codeReview.understandingVerdict || null,
            progressiveHints: codeReview.progressiveHints || [],
            difficulty: codeReview.difficulty || null,
          }
        : null,
      intelligence: {
        newWeaknesses: recordedGaps.map((g) => ({ id: String(g._id), category: g.category, description: g.description, severity: g.severity })),
        independenceScore: updated.independence?.score,
        mastery: await (async () => {
          const m = await db.collection('topic_mastery').findOne({ userId: req.userId, classroomId: classroom._id, conceptId: exercise.conceptId });
          return m ? { score: m.score, level: m.level } : null;
        })(),
      },
    });
  }),
);

/** Concrete progressive hint that never reveals the full solution. */
router.post(
  '/classrooms/:classroomId/exercises/:exerciseId/hint',
  asyncHandler(async (req, res) => {
    const data = validate(z.object({ level: z.number().int().min(1).max(3).default(1) }), req.body);
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const exercise = await db.collection('practical_exercises').findOne({
      _id: toOid(req.params.exerciseId),
      classroomId: classroom._id,
    });
    if (!exercise) throw notFound('Exercise not found');
    const concept = await db.collection('syllabus_units').findOne({ _id: exercise.conceptId });
    const attempts = await db
      .collection('code_submissions')
      .find({ exerciseId: exercise._id, userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();
    const failing = (attempts[0]?.testResults || []).filter((t) => !t.passed).map((t) => t.id);

    const hints = {
      1: `Re-read the requirement. Which input shape have you not handled yet? ${failing.length ? `Focus on test ${failing[0]}.` : ''}`,
      2: `Break the problem into: read the input → identify the ${concept?.keywords?.[0] || 'key rule'} → transform → return. Which step is missing in your code?`,
      3: `Write the ${concept?.keywords?.[0] || 'core rule'} as a sentence in a comment first, then implement exactly that sentence. Once it runs, handle the empty input.`,
    };
    res.json({ level: data.level, hint: hints[data.level], concept: concept?.name || null });
  }),
);

router.get(
  '/classrooms/:classroomId/exercises',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const exercises = await db
      .collection('practical_exercises')
      .find({ classroomId: classroom._id })
      .sort({ createdAt: -1 })
      .limit(30)
      .toArray();
    const conceptIds = [...new Set(exercises.map((e) => String(e.conceptId)))].map(toOid).filter(Boolean);
    const concepts = conceptIds.length ? await db.collection('syllabus_units').find({ _id: { $in: conceptIds } }).toArray() : [];
    const conceptById = Object.fromEntries(concepts.map((c) => [String(c._id), c.name]));
    const mySubs = await db
      .collection('code_submissions')
      .find({ classroomId: classroom._id, userId: req.userId })
      .toArray();
    const byExercise = mySubs.reduce((acc, s) => {
      const k = String(s.exerciseId);
      acc[k] = acc[k] || { attempts: 0, solved: false };
      acc[k].attempts += 1;
      acc[k].solved = acc[k].solved || s.passed;
      return acc;
    }, {});
    res.json({
      exercises: exercises.map((e) => ({
        id: String(e._id),
        title: e.title,
        language: e.language,
        difficulty: e.difficulty,
        conceptId: String(e.conceptId),
        conceptName: conceptById[String(e.conceptId)] || 'Removed concept',
        createdAt: e.createdAt,
        myAttempts: byExercise[String(e._id)]?.attempts || 0,
        solved: Boolean(byExercise[String(e._id)]?.solved),
      })),
    });
  }),
);

router.get(
  '/classrooms/:classroomId/exercises/:exerciseId',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const exercise = await db.collection('practical_exercises').findOne({
      _id: toOid(req.params.exerciseId),
      classroomId: classroom._id,
    });
    if (!exercise) throw notFound('Exercise not found');
    const concept = await db.collection('syllabus_units').findOne({ _id: exercise.conceptId });
    const submissions = await db
      .collection('code_submissions')
      .find({ exerciseId: exercise._id, userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();
    res.json({
      exercise: {
        id: String(exercise._id),
        title: exercise.title,
        prompt: exercise.prompt,
        language: exercise.language,
        starterCode: exercise.starterCode,
        difficulty: exercise.difficulty,
        rubric: exercise.rubric,
        tests: exercise.tests.filter((t) => !t.hidden).map((t) => ({ id: t.id, name: t.name, args: t.args, expected: t.expected })),
        hiddenTestCount: exercise.tests.filter((t) => t.hidden).length,
        concept: concept ? { id: String(concept._id), name: concept.name, description: concept.description } : null,
      },
      submissions: submissions.map((s) => ({
        id: String(s._id),
        attempt: s.attempt,
        passed: s.passed,
        code: s.code,
        createdAt: s.createdAt,
        results: (s.testResults || []).map((r) => ({ id: r.id, passed: r.passed })),
      })),
    });
  }),
);

export default router;
