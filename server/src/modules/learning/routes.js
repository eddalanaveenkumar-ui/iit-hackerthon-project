import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../../utils/errors.js';
import { validate } from '../../utils/validation.js';
import { requireClassroomMember, toOid } from '../classrooms/access.js';
import { isFeatureEnabled } from '../ai/config-store.js';
import { runJsonTask, runJsonTaskLocally } from '../ai/orchestrator.js';
import { prompts } from '../ai/prompts.js';
import { executeCode } from '../../utils/sandbox.js';
import { localEvaluateAnswers, normaliseEvaluation } from '../ai/ui/teaching-engine.js';
import { repairUiDocument, parseComponent } from '../ai/ui/protocol.js';
import { generateLesson, loadLesson, lessonComponent, validateAnswers } from './lessons.js';
import {
  getOrCreateProgress,
  serialiseProgress,
  markComponentComplete,
  gradeQuiz,
  recordFormSubmission,
  listProgress,
  summariseProgress,
  clearProgress,
} from './progress.js';
import { applyMasteryEvidence, getOrCreateProfile } from '../intelligence/profile.js';
import { analyseInteraction } from '../intelligence/gap-engine.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Idempotency for form submissions.
 *
 * A double-clicked submit button, a retried request after a flaky network, or a
 * React StrictMode double-invoke must not grade the same answers twice or burn
 * a second model call. The key is (user, lesson, component, payload hash); a
 * repeat within 10 minutes returns the stored response instead of re-evaluating.
 */
async function withSubmissionLock({ userId, lessonId, componentId, payload, ttlMinutes = 10 }, handler) {
  const db = getDb();
  const crypto = await import('node:crypto');
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
  const key = `${userId}:${lessonId}:${componentId}:${hash}`;
  const existing = await db.collection('ui_submissions').findOne({ _id: key });
  if (existing && Date.now() - new Date(existing.createdAt).getTime() < ttlMinutes * 60_000) {
    return { ...existing.result, duplicate: true };
  }
  const result = await handler();
  await db.collection('ui_submissions').updateOne(
    { _id: key },
    { $set: { _id: key, userId: toOid(userId), lessonId, componentId, createdAt: new Date(), result } },
    { upsert: true },
  );
  return { ...result, duplicate: false };
}

/**
 * Read progress for a lesson without resetting its denominator.
 *
 * `totalComponents` is the count of teachable components in the stored document.
 * Passing 0 on a read (the earlier behaviour) made a lesson with 2 recorded
 * completions and a denominator of 0 read as "100% complete" — technically
 * consistent, obviously wrong to a student.
 */
async function readProgress({ userId, classroomId = null, lessonId, document = null }) {
  const total = document ? countComponents(document.components) : 0;
  const doc = await getOrCreateProgress({ userId, classroomId, lessonId, totalComponents: total });
  return serialiseProgress(doc);
}

/** Components that count toward completion (containers are structure, not steps). */
function countComponents(components = []) {
  let n = 0;
  const walk = (list) => {
    for (const component of list || []) {
      if (!['layout', 'tabs', 'accordion'].includes(component.type)) n += 1;
      if (component.children) walk(component.children);
      if (component.tabs) component.tabs.forEach((t) => walk(t.children));
      if (component.items) component.items.forEach((i) => walk(i.children));
    }
  };
  walk(components);
  return n;
}

/* -------------------------------------------------------------------------- */
/* POST /api/ai-tutor/generate                                                 */
/* -------------------------------------------------------------------------- */

router.post(
  '/ai-tutor/generate',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        prompt: z.string().trim().min(1).max(4000),
        mode: z.enum(['learn', 'teach', 'test', 'practise', 'continue']).default('learn'),
        classroomId: z.string().optional().nullable(),
        conceptId: z.string().optional().nullable(),
        sessionId: z.string().optional().nullable(),
        level: z.enum(['beginner', 'developing', 'proficient', 'advanced']).optional(),
        subject: z.string().max(80).optional(),
        stream: z.boolean().optional(),
      }),
      req.body,
    );
    if (!(await isFeatureEnabled('tutoring'))) throw forbidden('AI tutoring is currently disabled platform-wide');
    if (data.classroomId) await requireClassroomMember(data.classroomId, req.userId);

    const result = await generateLesson({ userId: req.userId, input: data });

    // Streaming, in the only sense that helps here: a long tutorial is generated
    // server-side in one validated document (partial JSON cannot be rendered),
    // then delivered as NDJSON progress events followed by the document. The
    // client shows real stages instead of an indeterminate spinner.
    if (data.stream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      const emit = (event) => res.write(`${JSON.stringify(event)}\n`);
      emit({ event: 'stage', stage: 'analysed', subject: result.analysis.subject, level: result.analysis.level, concept: result.lesson.conceptName });
      emit({ event: 'stage', stage: 'authored', components: result.document.components.length, source: result.source });
      emit({ event: 'document', document: result.document, lesson: result.lesson, ai: result.ai, analysis: result.analysis, dropped: result.dropped });
      return res.end();
    }

    res.status(201).json({
      document: result.document,
      lesson: result.lesson,
      analysis: result.analysis,
      source: result.source,
      dropped: result.dropped,
      ai: result.ai,
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* POST /api/ai-tutor/continue                                                 */
/* -------------------------------------------------------------------------- */

router.post(
  '/ai-tutor/continue',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        lessonId: z.string().min(1).max(80),
        prompt: z.string().trim().min(1).max(2000).default('Continue the lesson with the next step.'),
        mode: z.enum(['learn', 'teach', 'test', 'practise', 'continue']).default('continue'),
        classroomId: z.string().optional().nullable(),
      }),
      req.body,
    );
    if (data.classroomId) await requireClassroomMember(data.classroomId, req.userId);
    // The prior lesson must belong to this learner — otherwise `continue` would
    // let one account read another's generated material.
    const previous = await loadLesson({ userId: req.userId, lessonId: data.lessonId });
    const result = await generateLesson({
      userId: req.userId,
      input: {
        prompt: data.prompt,
        mode: data.mode,
        classroomId: data.classroomId || previous.classroomId,
        conceptId: previous.conceptId,
        sessionId: null,
      },
    });
    await getDb().collection('ui_lessons').updateOne(
      { lessonId: previous.document.response_id, userId: toOid(req.userId) },
      { $set: { continuedBy: result.document.response_id, continuedAt: new Date() } },
    );
    res.status(201).json({
      document: result.document,
      lesson: result.lesson,
      analysis: result.analysis,
      source: result.source,
      ai: result.ai,
      previousLessonId: data.lessonId,
    });
  }),
);

/** Load a stored lesson (re-render after refresh without a second model call). */
router.get(
  '/ai-tutor/lessons/:lessonId',
  asyncHandler(async (req, res) => {
    const lesson = await loadLesson({ userId: req.userId, lessonId: req.params.lessonId });
    res.json(lesson);
  }),
);

/* -------------------------------------------------------------------------- */
/* POST /api/learning/forms/submit  — dynamic question form answer processing  */
/* -------------------------------------------------------------------------- */

router.post(
  '/learning/forms/submit',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        form_id: z.string().min(1).max(80),
        lesson_id: z.string().max(80).optional().nullable(),
        conversation_id: z.string().max(80).optional().nullable(),
        classroom_id: z.string().optional().nullable(),
        answers: z
          .array(
            z.object({
              question_id: z.string().min(1).max(64),
              value: z.union([z.string().max(20_000), z.number().finite(), z.boolean(), z.array(z.string().max(2000)).max(50), z.null()]),
            }),
          )
          .min(1)
          .max(40),
      }),
      req.body,
    );
    if (data.classroom_id) await requireClassroomMember(data.classroom_id, req.userId);
    if (!(await isFeatureEnabled('dynamic_ui'))) throw forbidden('Dynamic UI lessons are currently disabled');

    const { component: form, lesson } = await lessonComponent({ userId: req.userId, lessonId: data.lesson_id || data.form_id, componentId: data.form_id });
    if (form.type !== 'question_form' && form.type !== 'form') throw badRequest('That component is not a question form');

    const questions = form.type === 'question_form' ? form.questions : (form.fields || []).map((f) => ({
      id: f.id,
      type: f.type,
      question: f.label,
      required: f.required !== false,
      options: (f.options || []).map((o) => o.value),
    }));

    const accepted = validateAnswers({ questions, answers: data.answers });

    const submit = async () => {
      // The AI receives the original questions, the complete answer set and the
      // learning context. Its evaluation is *advisory*: invalid output falls back
      // to the deterministic evaluator, and nothing it says is rendered as HTML.
      const { data: raw, meta } = await runJsonTask('ui_evaluation', {
        messages: prompts.uiEvaluation({
          questions,
          answers: accepted,
          execution: [],
          context: {
            concept: lesson.conceptId ? { id: lesson.conceptId, name: form.title || '' } : null,
            adaptiveLevel: lesson.level,
          },
        }),
        meta: { task: 'ui_evaluation', questions, answers: accepted },
        feature: 'dynamic_ui',
        userId: req.userId,
        classroomId: data.classroom_id ? toOid(data.classroom_id) : null,
        timeoutMs: 30_000,
      }).catch(() => ({ data: null, meta: { provider: 'local', model: 'local-analyser', simulated: true } }));

      const fallback = localEvaluateAnswers({ questions, answers: accepted });
      const evaluation = normaliseEvaluation(raw, fallback);

      // A follow-up form is accepted only if it survives the same validation as
      // any other authored component; otherwise the student gets the text reply.
      let followUp = null;
      if (raw && typeof raw === 'object' && raw.follow_up_form) {
        const single = parseComponent({ id: 'follow_up', ...raw.follow_up_form, type: 'question_form' });
        if (single.ok) followUp = single.component;
        else {
          const repair = repairUiDocument({ version: '1.0', response_id: 'follow_up', response_type: 'question_form', components: [{ id: 'follow_up', ...raw.follow_up_form }] });
          if (repair?.document.components.length === 1) followUp = repair.document.components[0];
        }
      }

      await recordFormSubmission({
        userId: req.userId,
        classroomId: data.classroom_id || lesson.classroomId || null,
        lessonId: lesson.lessonId,
        title: form.title || lesson.prompt,
        componentId: form.id,
        answers: accepted,
        evaluation,
      });

      // Evidence, not self-report: a wrong answer on a graded check is a gap.
      if (lesson.classroomId && lesson.conceptId) {
        const wrong = (evaluation.per_question || []).filter((p) => p.verdict === 'incorrect' || p.verdict === 'unanswered');
        await analyseInteraction({
          userId: req.userId,
          classroomId: lesson.classroomId,
          concept: { id: lesson.conceptId, name: form.title || 'Concept' },
          text: accepted.map((a) => `Q${a.question_id}: ${typeof a.value === 'string' ? a.value.slice(0, 400) : JSON.stringify(a.value)}`).join('\n'),
          signal: { wrongAnswer: wrong.length > 0, correct: wrong.length === 0 && evaluation.score >= 70 },
          context: { source: 'question_form', evaluation },
        }).catch(() => null);
        await applyMasteryEvidence({
          userId: req.userId,
          classroomId: lesson.classroomId,
          conceptId: lesson.conceptId,
          correct: wrong.length === 0 && (evaluation.score ?? 0) >= 70,
          source: 'question_form',
        }).catch(() => null);
      }

      return {
        form_id: form.id,
        evaluation: {
          overall: evaluation.overall || '',
          score: evaluation.score ?? null,
          per_question: evaluation.per_question || [],
          gaps: evaluation.gaps || [],
          next_step: evaluation.next_step || '',
          source: evaluation.source || 'local',
        },
        follow_up_form: followUp,
        progress: null,
        ai: { provider: meta.provider, model: meta.model, simulated: Boolean(meta.simulated) },
      };
    };

    const result = await withSubmissionLock(
      { userId: req.userId, lessonId: lesson.lessonId, componentId: form.id, payload: accepted },
      submit,
    );

    // Ensure (not create) a progress document: the submission above already
    // created it. Reusing the total component count stops a fresh document with
    // total=0 from reading as "100% complete".
    const progress = await readProgress({
      userId: req.userId,
      classroomId: lesson.classroomId || null,
      lessonId: lesson.lessonId,
      document: lesson.document,
    });

    res.status(201).json({ ...result, progress });
  }),
);

/* -------------------------------------------------------------------------- */
/* POST /api/learning/quiz/submit                                              */
/* -------------------------------------------------------------------------- */

router.post(
  '/learning/quiz/submit',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        lesson_id: z.string().max(80).optional().nullable(),
        quiz_id: z.string().min(1).max(80),
        classroom_id: z.string().optional().nullable(),
        answers: z.array(z.object({ question_id: z.string().min(1).max(64), value: z.number().int().min(0).max(20) })).min(1).max(20),
      }),
      req.body,
    );
    if (data.classroom_id) await requireClassroomMember(data.classroom_id, req.userId);
    const { component: quiz, lesson } = await lessonComponent({ userId: req.userId, lessonId: data.lesson_id || data.quiz_id, componentId: data.quiz_id });
    if (quiz.type !== 'quiz') throw badRequest('That component is not a quiz');

    const result = await withSubmissionLock(
      { userId: req.userId, lessonId: lesson.lessonId, componentId: quiz.id, payload: data.answers },
      () => gradeQuiz({
        userId: req.userId,
        classroomId: data.classroom_id ? toOid(data.classroom_id) : lesson.classroomId,
        lessonId: lesson.lessonId,
        title: quiz.title || lesson.prompt,
        conceptId: lesson.conceptId,
        componentId: quiz.id,
        questions: quiz.questions,
        answers: data.answers,
      }),
    );

    res.status(201).json({
      quiz_id: quiz.id,
      score: result.score,
      correct: result.correct,
      max: result.max,
      passing: result.passing,
      results: result.results,
      duplicate: result.duplicate,
      progress: await readProgress({ userId: req.userId, classroomId: lesson.classroomId || null, lessonId: lesson.lessonId, document: lesson.document }),
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* POST /api/learning/code/execute  — sandboxed execution for code components   */
/* -------------------------------------------------------------------------- */

router.post(
  '/learning/code/execute',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        lesson_id: z.string().max(80).optional().nullable(),
        component_id: z.string().max(80).optional().nullable(),
        language: z.enum(['javascript', 'python', 'java', 'sql']).default('python'),
        code: z.string().min(1).max(60_000),
        tests: z
          .array(
            z.object({
              id: z.string().max(40),
              name: z.string().max(120).optional(),
              args: z.array(z.union([z.string().max(2000), z.number().finite(), z.boolean()])).max(4).optional(),
              expected: z.union([z.string().max(2000), z.number().finite()]).optional(),
            }),
          )
          .max(10)
          .optional(),
      }),
      req.body,
    );

    // Tests come from the stored lesson when a lesson component is named, so a
    // client cannot invent its own passing tests. Ad-hoc runs send their own.
    let tests = data.tests || [];
    if (data.lesson_id && data.component_id) {
      const { component } = await lessonComponent({ userId: req.userId, lessonId: data.lesson_id, componentId: data.component_id });
      tests = (component.tests || []).map((t) => ({ id: t.id, name: t.name, args: t.args, expected: t.expected }));
    }

    const outcome = await executeCode({ code: data.code, language: data.language, tests });
    await getDb().collection('code_runs').insertOne({
      userId: toOid(req.userId),
      lessonId: data.lesson_id || null,
      componentId: data.component_id || null,
      language: data.language,
      executed: Boolean(outcome.executed),
      passed: (outcome.results || []).filter((r) => r.passed).length,
      total: (outcome.results || []).length,
      createdAt: new Date(),
    }).catch(() => {});

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

/* -------------------------------------------------------------------------- */
/* progress                                                                    */
/* -------------------------------------------------------------------------- */

router.post(
  '/learning/progress',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        lesson_id: z.string().min(1).max(80),
        classroom_id: z.string().optional().nullable(),
        title: z.string().max(200).optional(),
        concept_id: z.string().optional().nullable(),
        completed_component_id: z.string().max(80).optional(),
        total_components: z.number().int().min(0).max(200).optional(),
      }),
      req.body,
    );
    if (data.classroom_id) await requireClassroomMember(data.classroom_id, req.userId);
    const progress = data.completed_component_id
      ? await markComponentComplete({
          userId: req.userId,
          classroomId: data.classroom_id || null,
          lessonId: data.lesson_id,
          title: data.title || '',
          componentId: data.completed_component_id,
          totalComponents: data.total_components || 0,
        })
      : serialiseProgress(await getOrCreateProgress({
          userId: req.userId,
          classroomId: data.classroom_id || null,
          lessonId: data.lesson_id,
          title: data.title || '',
          conceptId: data.concept_id || null,
          totalComponents: data.total_components || 0,
        }));
    res.json({ progress });
  }),
);

router.get(
  '/learning/progress/:studentId',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        classroomId: z.string().optional(),
        lessonId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(40),
      }),
      req.query,
    );
    const target = String(req.params.studentId);
    const isSelf = target === String(req.userId) || target === 'me';
    if (!isSelf) {
      // A teacher may read a learner's progress only through their classroom and
      // only while their own monitoring switch is on — the same gate as every
      // other learner-data route.
      if (!data.classroomId) throw forbidden('A classroom id is required to read another learner’s progress');
      const { membership } = await requireClassroomMember(data.classroomId, req.userId);
      if (membership.role === 'student') throw forbidden('Only classroom staff can read another learner’s progress');
      if (membership.role !== 'owner' && membership.permissions?.monitorStudents === false) {
        throw forbidden('Monitoring is switched off for you in this classroom');
      }
    }

    const items = data.lessonId
      ? [serialiseProgress(await getOrCreateProgress({
          userId: isSelf ? req.userId : target,
          classroomId: data.classroomId || null,
          lessonId: data.lessonId,
        }))]
      : await listProgress({ userId: isSelf ? req.userId : target, classroomId: data.classroomId || null, limit: data.limit });

    const db = getDb();
    const conceptIds = [...new Set(items.map((i) => i.conceptId).filter(Boolean))].map(toOid).filter(Boolean);
    const concepts = conceptIds.length ? await db.collection('syllabus_units').find({ _id: { $in: conceptIds } }).project({ name: 1 }).toArray() : [];
    const nameById = Object.fromEntries(concepts.map((c) => [String(c._id), c.name]));

    res.json({
      studentId: isSelf ? String(req.userId) : target,
      lessons: items.map((i) => ({ ...i, conceptName: i.conceptId ? nameById[i.conceptId] || null : null })),
      summary: summariseProgress(items),
    });
  }),
);

router.delete(
  '/learning/progress',
  asyncHandler(async (req, res) => {
    const data = validate(z.object({ lessonId: z.string().max(80).optional() }), req.query);
    const deleted = await clearProgress({ userId: req.userId, lessonId: data.lessonId || null });
    res.json({ ok: true, deleted });
  }),
);

/**
 * Resume the most recent lesson — the "continue where you left off" affordance.
 * Deliberately separate from GET progress: it returns the authored document and
 * the personal profile in one round trip.
 */
router.get(
  '/learning/resume',
  asyncHandler(async (req, res) => {
    const data = validate(z.object({ classroomId: z.string().optional() }), req.query);
    const db = getDb();
    const filter = { userId: toOid(req.userId) };
    if (data.classroomId) filter.classroomId = toOid(data.classroomId);
    const [latest] = await getDb()
      .collection('ui_lessons')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();
    if (!latest) return res.json({ lesson: null, progress: null });
    const progress = serialiseProgress(await getOrCreateProgress({
      userId: req.userId,
      classroomId: latest.classroomId || null,
      lessonId: latest.lessonId,
      title: latest.prompt?.slice(0, 120) || '',
    }));
    const profile = latest.classroomId ? await getOrCreateProfile(req.userId, latest.classroomId).catch(() => null) : null;
    const concept = latest.conceptId ? await db.collection('syllabus_units').findOne({ _id: latest.conceptId }).catch(() => null) : null;
    return res.json({
      lesson: { lessonId: latest.lessonId, prompt: latest.prompt, document: latest.document, source: latest.source, createdAt: latest.createdAt },
      progress,
      concept: concept ? { id: String(concept._id), name: concept.name } : null,
      profile: profile ? { knowledgeLevel: profile.knowledgeLevel, independence: profile.independence } : null,
    });
  }),
);

export default router;
