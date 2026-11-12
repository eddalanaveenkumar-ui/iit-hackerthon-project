import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../../utils/errors.js';
import { validate, round } from '../../utils/validation.js';
import { requireClassroomMember, requireClassroomStaff, toOid } from '../classrooms/access.js';
import { isFeatureEnabled } from '../ai/config-store.js';
import { runJsonTask, runJsonTaskLocally } from '../ai/orchestrator.js';
import { prompts } from '../ai/prompts.js';
import {
  getOrCreateProfile,
  applyMasteryEvidence,
  refreshProfileAggregates,
} from '../intelligence/profile.js';
import { analyseInteraction, resolveGap, getOpenGaps } from '../intelligence/gap-engine.js';

const router = Router();

const GENERATABLE_KINDS = ['topic_quiz', 'unit_test', 'practical', 'conceptual', 'revision'];

async function loadConceptContext(conceptId, classroomId) {
  const db = getDb();
  const concept = await db.collection('syllabus_units').findOne({ _id: toOid(conceptId), classroomId: toOid(classroomId), type: 'concept' });
  if (!concept) throw notFound('Concept not found in this classroom');
  const unit = concept.parentId ? await db.collection('syllabus_units').findOne({ _id: concept.parentId }) : null;
  const subject = concept.subjectId ? await db.collection('syllabus_units').findOne({ _id: concept.subjectId }) : null;
  return { concept, unit, subject };
}

function sanitiseQuestions(questions, conceptId) {
  return (Array.isArray(questions) ? questions : [])
    .slice(0, 20)
    .map((q, i) => {
      const type = q.type === 'short_answer' ? 'short_answer' : 'multiple_choice';
      const base = {
        id: q.id || `q${i + 1}`,
        type,
        prompt: String(q.prompt || '').slice(0, 900),
        conceptId,
        difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
        explanation: String(q.explanation || '').slice(0, 600),
      };
      if (type === 'multiple_choice') {
        const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).slice(0, 400)).slice(0, 6);
        if (options.length < 2) return null;
        const idx = Number(q.correctIndex);
        return {
          ...base,
          options,
          correctIndex: Number.isInteger(idx) && idx >= 0 && idx < options.length ? idx : 0,
        };
      }
      return { ...base, rubric: String(q.rubric || 'Correct, complete and uses the concept\'s terminology').slice(0, 600) };
    })
    .filter((q) => q && q.prompt);
}

/**
 * Create an assessment.
 *  - origin=student  (student-triggered) or origin=teacher
 *  - origin=ai       (AI-recommended, optional + postponable)
 */
router.post(
  '/classrooms/:classroomId/assessments',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        conceptId: z.string(),
        kind: z.enum(GENERATABLE_KINDS).default('topic_quiz'),
        origin: z.enum(['student', 'teacher', 'ai']).default('student'),
        reason: z.string().max(400).optional(),
        questionCount: z.number().int().min(3).max(15).optional(),
      }),
      req.body,
    );
    const { classroom, membership } = await requireClassroomMember(req.params.classroomId, req.userId);
    if (data.origin === 'teacher' && !['owner', 'co_owner', 'teacher'].includes(membership.role)) {
      throw forbidden('Only classroom staff can assign teacher assessments');
    }
    if (!(await isFeatureEnabled('assessment_generation'))) {
      throw forbidden('Assessment generation is disabled by the platform administrator');
    }

    const db = getDb();
    const { concept, unit, subject } = await loadConceptContext(data.conceptId, classroom._id);
    const profile = await getOrCreateProfile(req.userId, classroom._id);
    const openGaps = await getOpenGaps(req.userId, classroom._id, { conceptId: concept._id });
    const count = data.questionCount || (data.kind === 'unit_test' ? 8 : 5);

    const { data: generated, meta } = await runJsonTask('assessment_generation', {
      messages: prompts.assessment({
        context: {
          concept: { ...concept, unitName: unit?.name, subjectName: subject?.name },
          profile,
          openGaps,
        },
        kind: data.kind,
        count,
      }),
      meta: {
        task: 'assessment_generation',
        concept: { ...concept, unitName: unit?.name, subjectName: subject?.name },
        conceptId: concept._id,
        kind: data.kind,
        openGaps,
      },
      feature: 'assessment_generation',
      userId: req.userId,
      classroomId: classroom._id,
    });

    let questions = sanitiseQuestions(generated?.questions, concept._id);
    if (!questions.length) {
      // A model can answer 200 with JSON that parses but contains nothing usable —
      // no options, blank prompts, the wrong shape. Failing the request there
      // denies the learner an assessment for a reason that is not theirs, so
      // generate from the deterministic analyser instead. A slightly generic quiz
      // is better than an error dialog in front of a student.
      const local = await runJsonTaskLocally('assessment_generation', {
        messages: prompts.assessment({
          context: {
            concept: { ...concept, unitName: unit?.name, subjectName: subject?.name },
            profile,
            openGaps,
          },
          kind: data.kind,
          count,
        }),
        meta: {
          task: 'assessment_generation',
          concept: { ...concept, unitName: unit?.name, subjectName: subject?.name },
          conceptId: concept._id,
          kind: data.kind,
          openGaps,
        },
      });
      questions = sanitiseQuestions(local?.data?.questions, concept._id);
    }
    if (!questions.length) throw badRequest('Could not generate a valid assessment. Please try again.');

    const now = new Date();
    const doc = {
      classroomId: classroom._id,
      conceptId: concept._id,
      unitId: concept.parentId || null,
      subjectId: concept.subjectId || null,
      userId: req.userId,
      createdByUserId: req.userId,
      origin: data.origin,
      kind: data.kind,
      title: String(generated?.title || `Topic Quiz — ${concept.name}`).slice(0, 160),
      status: data.origin === 'ai' ? 'available' : 'available',
      recommendedReason: data.reason || generated?.rationale || '',
      questions,
      maxScore: questions.length,
      durationMinutes: Number(generated?.durationMinutes) || (data.kind === 'unit_test' ? 25 : 12),
      aiMeta: { provider: meta.provider, model: meta.model },
      createdAt: now,
    };
    const { insertedId } = await db.collection('assessments').insertOne(doc);
    if (data.origin === 'ai') {
      await db.collection('student_learning_profiles').updateOne(
        { userId: req.userId, classroomId: classroom._id },
        { $set: { pendingAssessmentId: insertedId, assessmentRecommendedAt: now } },
      );
    }
    res.status(201).json({
      assessment: {
        id: String(insertedId),
        title: doc.title,
        kind: doc.kind,
        origin: doc.origin,
        status: doc.status,
        questionCount: questions.length,
        durationMinutes: doc.durationMinutes,
        recommendedReason: doc.recommendedReason,
        concept: { id: String(concept._id), name: concept.name },
      },
      // Questions are returned without correct answers.
      questions: questions.map(publicQuestion),
    });
  }),
);

function publicQuestion(q) {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: q.options || null,
    difficulty: q.difficulty,
    rubric: q.rubric || null,
  };
}

/** List the student's assessments with status. */
router.get(
  '/classrooms/:classroomId/assessments',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const assessments = await db
      .collection('assessments')
      .find({ classroomId: classroom._id, userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(40)
      .toArray();
    const results = await db
      .collection('assessment_results')
      .find({ classroomId: classroom._id, userId: req.userId })
      .sort({ submittedAt: -1 })
      .toArray();
    const conceptIds = [...new Set(assessments.map((a) => String(a.conceptId)))].map((id) => toOid(id)).filter(Boolean);
    const concepts = conceptIds.length ? await db.collection('syllabus_units').find({ _id: { $in: conceptIds } }).toArray() : [];
    const conceptById = Object.fromEntries(concepts.map((c) => [String(c._id), c.name]));
    const resultByAssessment = Object.fromEntries(results.map((r) => [String(r.assessmentId), r]));

    res.json({
      assessments: assessments.map((a) => ({
        id: String(a._id),
        title: a.title,
        kind: a.kind,
        origin: a.origin,
        status: a.status,
        conceptId: String(a.conceptId),
        conceptName: conceptById[String(a.conceptId)] || 'Removed concept',
        questionCount: a.questions?.length || 0,
        durationMinutes: a.durationMinutes,
        recommendedReason: a.recommendedReason,
        createdAt: a.createdAt,
        result: resultByAssessment[String(a._id)]
          ? {
              id: String(resultByAssessment[String(a._id)]._id),
              percentage: resultByAssessment[String(a._id)].percentage,
              score: resultByAssessment[String(a._id)].score,
              maxScore: resultByAssessment[String(a._id)].maxScore,
              submittedAt: resultByAssessment[String(a._id)].submittedAt,
            }
          : null,
      })),
    });
  }),
);

router.get(
  '/classrooms/:classroomId/assessments/:assessmentId',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const assessment = await db.collection('assessments').findOne({
      _id: toOid(req.params.assessmentId),
      classroomId: classroom._id,
      userId: req.userId,
    });
    if (!assessment) throw notFound('Assessment not found');
    const concept = await db.collection('syllabus_units').findOne({ _id: assessment.conceptId });
    res.json({
      assessment: {
        id: String(assessment._id),
        title: assessment.title,
        kind: assessment.kind,
        origin: assessment.origin,
        status: assessment.status,
        durationMinutes: assessment.durationMinutes,
        recommendedReason: assessment.recommendedReason,
        concept: concept ? { id: String(concept._id), name: concept.name } : null,
      },
      questions: (assessment.questions || []).map(publicQuestion),
    });
  }),
);

/** Students may postpone optional (AI-recommended) assessments. */
router.post(
  '/classrooms/:classroomId/assessments/:assessmentId/postpone',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const assessment = await db.collection('assessments').findOne({
      _id: toOid(req.params.assessmentId),
      classroomId: classroom._id,
      userId: req.userId,
    });
    if (!assessment) throw notFound('Assessment not found');
    if (assessment.status === 'completed') throw badRequest('This assessment is already completed');
    await db.collection('assessments').updateOne(
      { _id: assessment._id },
      { $set: { status: 'postponed', postponedAt: new Date() } },
    );
    await db.collection('student_learning_profiles').updateOne(
      { userId: req.userId, classroomId: classroom._id },
      { $unset: { pendingAssessmentId: '' } },
    );
    res.json({ ok: true, status: 'postponed' });
  }),
);

/**
 * Submit answers -> grading -> gap analysis -> profile + mastery update.
 */
router.post(
  '/classrooms/:classroomId/assessments/:assessmentId/submit',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        answers: z.array(z.object({ questionId: z.string(), answer: z.union([z.string(), z.number(), z.null()]) })).min(1),
        durationSeconds: z.number().int().min(0).max(86_400).optional(),
        hintUsage: z.number().int().min(0).max(50).optional(),
      }),
      req.body,
    );
    const { classroom } = await requireClassroomMember(req.params.classroomId, req.userId);
    const db = getDb();
    const assessment = await db.collection('assessments').findOne({
      _id: toOid(req.params.assessmentId),
      classroomId: classroom._id,
      userId: req.userId,
    });
    if (!assessment) throw notFound('Assessment not found');
    const existingResult = await db.collection('assessment_results').findOne({ assessmentId: assessment._id, userId: req.userId });
    if (existingResult) throw badRequest('You have already completed this assessment');

    const answerByQ = Object.fromEntries(data.answers.map((a) => [a.questionId, a.answer]));
    const graded = [];
    const concept = await db.collection('syllabus_units').findOne({ _id: assessment.conceptId });

    for (const q of assessment.questions || []) {
      const raw = answerByQ[q.id];
      if (q.type === 'multiple_choice') {
        const numeric = raw === null || raw === undefined || raw === '' ? -1 : Number(raw);
        const correct = numeric === q.correctIndex;
        graded.push({
          questionId: q.id,
          prompt: q.prompt,
          answer: raw ?? null,
          correct,
          score: correct ? 1 : 0,
          analysis: correct ? '' : `Incorrect option chosen. ${q.explanation || ''}`.trim(),
          misconception: correct ? null : describeMisconception(concept?.name, q),
          difficulty: q.difficulty,
        });
      } else {
        // Short answer: graded against the rubric using the assessment-analysis model.
        const answerText = String(raw ?? '').trim();
        graded.push({
          questionId: q.id,
          prompt: q.prompt,
          answer: raw ?? null,
          correct: false,
          score: 0,
          rubric: q.rubric,
          needsRubricGrading: true,
          analysis: '',
          misconception: null,
          difficulty: q.difficulty,
        });
      }
    }

    const rubricItems = graded.filter((g) => g.needsRubricGrading);
    let aiFeedback = { strengths: [], gaps: [], misconceptions: [], nextSteps: [] };
    if (rubricItems.length) {
      const { data: analysis } = await runJsonTask('assessment_analysis', {
        messages: prompts.assessmentAnalysis({
          concept,
          gradedAnswers: rubricItems.map((r) => ({ questionId: r.questionId, prompt: r.prompt, answer: r.answer, rubric: r.rubric })),
        }),
        meta: { task: 'assessment_analysis', answers: rubricItems, concept },
        feature: 'ai_assessments',
        userId: req.userId,
        classroomId: classroom._id,
      });
      if (analysis && typeof analysis === 'object') {
        aiFeedback = {
          strengths: (analysis.strengths || []).slice(0, 6),
          gaps: (analysis.gaps || []).slice(0, 6),
          misconceptions: (analysis.misconceptions || []).slice(0, 6),
          nextSteps: (analysis.nextSteps || []).slice(0, 6),
        };
        // Heuristic rubric grading: award credit when the answer is substantive.
        rubricItems.forEach((item) => {
          const text = String(item.answer || '');
          const substantive = text.split(/\s+/).filter(Boolean).length >= 12;
          const rated = analysis.masteryPercentage;
          const award = substantive && (typeof rated !== 'number' || rated >= 50);
          item.score = award ? 1 : 0;
          item.correct = award;
          item.analysis = award
            ? 'Answer addresses the rubric.'
            : 'Answer is too thin to demonstrate the rubric criteria.';
        });
      }
    }

    const score = graded.reduce((a, g) => a + (g.score || 0), 0);
    const maxScore = (assessment.questions || []).length;
    const percentage = round((score / (maxScore || 1)) * 100, 1);

    const resultDoc = {
      assessmentId: assessment._id,
      userId: req.userId,
      classroomId: classroom._id,
      conceptIds: [assessment.conceptId],
      answers: graded.map(({ needsRubricGrading, rubric, ...g }) => g),
      score,
      maxScore,
      percentage,
      durationSeconds: data.durationSeconds || 0,
      hintUsage: data.hintUsage || 0,
      aiFeedback,
      submittedAt: new Date(),
    };
    const { insertedId } = await db.collection('assessment_results').insertOne(resultDoc);
    await db.collection('assessments').updateOne(
      { _id: assessment._id },
      { $set: { status: 'completed', completedAt: new Date(), resultId: insertedId } },
    );

    // Mastery: one evidence point per question.
    for (const g of graded) {
      await applyMasteryEvidence({
        userId: req.userId,
        classroomId: classroom._id,
        conceptId: assessment.conceptId,
        unitId: assessment.unitId,
        subjectId: assessment.subjectId,
        correct: Boolean(g.correct),
        hinted: (data.hintUsage || 0) > 0,
        source: 'assessment',
      });
    }

    // Gap detection over the attempt.
    const wrong = graded.filter((g) => !g.correct);
    const gapAnalysis = await analyseInteraction({
      userId: req.userId,
      classroomId: classroom._id,
      concept: { id: assessment.conceptId, name: concept?.name || 'Concept', unitId: assessment.unitId, subjectId: assessment.subjectId },
      text: wrong.map((w) => `Q: ${w.prompt}\nStudent: ${w.answer ?? '(no answer)'}\n${w.analysis || ''}`).join('\n\n') || 'All answers correct.',
      signal: { wrongAnswer: wrong.length > 0, correct: percentage >= 80, assessmentMiss: wrong.length > 0 },
      context: { assessment: true, percentage },
      evidenceRef: insertedId,
    });

    // Strong performance resolves earlier weaknesses for this concept.
    let resolved = 0;
    if (percentage >= 85) {
      const gaps = await getOpenGaps(req.userId, classroom._id, { conceptId: assessment.conceptId });
      for (const g of gaps) {
        await resolveGap(g._id, `Resolved after scoring ${percentage}% on ${assessment.title}`);
        resolved += 1;
      }
    }

    const profile = await getOrCreateProfile(req.userId, classroom._id);
    const updated = await refreshProfileAggregates(req.userId, classroom._id, {
      stats: {
        ...profile.stats,
        assessmentsTaken: (profile.stats.assessmentsTaken || 0) + 1,
      },
      pendingAssessmentId: null,
    });
    const mastery = await db.collection('topic_mastery').findOne({
      userId: req.userId,
      classroomId: classroom._id,
      conceptId: assessment.conceptId,
    });
    await db.collection('student_activities').insertOne({
      userId: req.userId,
      classroomId: classroom._id,
      type: 'assessment_completed',
      title: `Scored ${percentage}% on ${assessment.title}`,
      meta: { assessmentId: String(assessment._id), percentage, kind: assessment.kind },
      conceptId: assessment.conceptId,
      minutes: Math.round((data.durationSeconds || 0) / 60),
      createdAt: new Date(),
    });

    res.status(201).json({
      result: {
        id: String(insertedId),
        score,
        maxScore,
        percentage,
        answers: resultDoc.answers.map((a) => ({
          questionId: a.questionId,
          correct: a.correct,
          analysis: a.analysis,
          misconception: a.misconception,
        })),
        aiFeedback,
        gapsDetected: gapAnalysis.findings,
        gapsResolved: resolved,
      },
      profile: {
        knowledgeLevel: updated.knowledgeLevel,
        learningSpeed: updated.learningSpeed,
        independence: updated.independence,
        conceptMastery: mastery ? { score: mastery.score, level: mastery.level, trend: mastery.trend } : null,
      },
      explanation: (assessment.questions || []).map((q) => ({
        questionId: q.id,
        prompt: q.prompt,
        correctAnswer: q.type === 'multiple_choice' ? q.options?.[q.correctIndex] : q.rubric,
        explanation: q.explanation,
      })),
    });
  }),
);

function describeMisconception(conceptName, question) {
  if (!question?.explanation) return `Misapplied the rule for ${conceptName || 'this concept'}.`;
  return `${question.explanation}`.slice(0, 400);
}

/** Teacher-assigned assessments for a classroom (staff view). */
router.get(
  '/classrooms/:classroomId/assessment-overview',
  asyncHandler(async (req, res) => {
    const { classroom } = await requireClassroomStaff(req.params.classroomId, req.userId, 'manageAssessments');
    const db = getDb();
    const results = await db
      .collection('assessment_results')
      .find({ classroomId: classroom._id })
      .sort({ submittedAt: -1 })
      .limit(300)
      .toArray();
    const userIds = [...new Set(results.map((r) => String(r.userId)))].map(toOid).filter(Boolean);
    const users = userIds.length ? await db.collection('users').find({ _id: { $in: userIds } }).toArray() : [];
    const nameById = Object.fromEntries(users.map((u) => [String(u._id), u.name]));
    const byUser = {};
    for (const r of results) {
      const key = String(r.userId);
      byUser[key] = byUser[key] || { userId: key, name: nameById[key] || 'Unknown', attempts: 0, total: 0 };
      byUser[key].attempts += 1;
      byUser[key].total += r.percentage;
    }
    res.json({
      attempts: results.length,
      averagePercentage: results.length ? round(results.reduce((a, r) => a + r.percentage, 0) / results.length, 1) : 0,
      students: Object.values(byUser)
        .map((u) => ({ ...u, averagePercentage: round(u.total / u.attempts, 1) }))
        .sort((a, b) => b.averagePercentage - a.averagePercentage),
      recent: results.slice(0, 15).map((r) => ({
        id: String(r._id),
        userId: String(r.userId),
        name: nameById[String(r.userId)] || 'Unknown',
        percentage: r.percentage,
        submittedAt: r.submittedAt,
      })),
    });
  }),
);

export default router;
