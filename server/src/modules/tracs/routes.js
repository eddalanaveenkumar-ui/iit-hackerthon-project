import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../../utils/errors.js';
import { validate } from '../../utils/validation.js';
import { toOid } from '../classrooms/access.js';
import { isFeatureEnabled } from '../ai/config-store.js';
import { recordGap } from '../intelligence/gap-engine.js';
import { extractDocument } from '../syllabus/extract.js';
import {
  extractTopics,
  chooseNextTopic,
  applyAnswerToTopic,
  masteryLabel,
  parseCommand,
  turnSchema,
} from './topics.js';
import {
  authorQuestion,
  authorExplanation,
  authorChecks,
  gradeAnswer,
  feedbackDocument,
  oneQuestionForm,
  explainMistake,
  assessUnderstanding,
  gapCategory,
  makeDocument,
  say,
  localExplanation,
  CHECK_COUNT,
} from './engine.js';
import { languageFor } from './question-bank.js';

/**
 * TRACS ROUTES
 * ============
 *
 *   POST /api/tracs/syllabus     upload a syllabus, get a session with topics
 *   GET  /api/tracs              list my sessions
 *   GET  /api/tracs/:id          one session: syllabus, topics, open question
 *   POST /api/tracs/:id/turn     the two commands — /test and /learn
 *   DELETE /api/tracs/:id        forget this session
 *
 * The chat surface has no free-text endpoint on purpose. A turn must name one
 * of the two commands, so "only /test and /learn" is a property of the API and
 * not just of the UI.
 */

const router = Router();

const MAX_SYLLABUS_BYTES = 15 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SYLLABUS_BYTES, files: 3 },
  // An allowlist at the transport layer as well as in `extractDocument`, so a
  // disallowed type is refused before it is buffered into memory.
  fileFilter: (_req, file, cb) => {
    const ok = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|presentationml\.presentation)|application\/vnd\.ms-word|text\/plain|text\/markdown|application\/octet-stream)$/.test(file.mimetype)
      || /\.(pdf|docx|pptx|txt|md)$/i.test(file.originalname || '');
    if (!ok) return cb(badRequest('Upload a PDF, DOCX, PPTX, TXT or Markdown syllabus.'));
    return cb(null, true);
  },
});

const SESSIONS = 'tracs_sessions';

function sessionView(session) {
  return {
    id: String(session._id),
    title: session.title,
    source: session.source,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    stats: session.stats || { answered: 0, correct: 0, topics: 0 },
    open_question: session.openQuestion || null,
    topics: (session.topics || []).map((topic) => ({
      id: topic.id,
      title: topic.title,
      unit: topic.unit,
      attempts: topic.attempts || 0,
      correct: topic.correct || 0,
      mastery: topic.mastery || 0,
      mastery_label: masteryLabel(topic),
      last_seen_at: topic.lastSeenAt || null,
      next_review_at: topic.nextReviewAt || null,
    })),
  };
}

async function loadSession(userId, id) {
  const db = getDb();
  const session = await db.collection(SESSIONS).findOne({ _id: toOid(id), userId: toOid(userId) });
  if (!session) throw notFound('That tracs session does not exist.');
  return session;
}

async function saveSession(session) {
  const db = getDb();
  const { _id, ...rest } = session;
  await db.collection(SESSIONS).updateOne(
    { _id },
    { $set: { ...rest, updatedAt: new Date() } },
  );
}

/* -------------------------------------------------------------------------- */
/* upload                                                                     */
/* -------------------------------------------------------------------------- */

router.post(
  '/tracs/syllabus',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!(await isFeatureEnabled('dynamic_ui'))) throw forbidden('Dynamic UI lessons are currently disabled');

    const files = [];
    if (req.file) files.push(req.file);

    const pasted = String(req.body?.text || '').trim();
    if (!files.length && !pasted) throw badRequest('Upload a syllabus file or paste its text.');

    // Extraction: the same reader the classroom syllabus uses (PDF/DOCX/PPTX/
    // TXT/MD, 15 MB), so there is one implementation of "read a document".
    let text = pasted;
    const sources = [];
    for (const file of files) {
      try {
        const extracted = await extractDocument({
          buffer: file.buffer,
          mimetype: file.mimetype,
          originalname: file.originalname,
        });
        if (extracted.text?.trim().length > 10) {
          text += `\n\n## ${extracted.filename}\n${extracted.text}`;
          sources.push({ filename: extracted.filename, words: extracted.words || 0, pages: extracted.pages || null });
        } else {
          sources.push({ filename: extracted.filename, error: 'no readable text' });
        }
      } catch (error) {
        sources.push({ filename: file.originalname, error: error.message });
      }
    }

    if (String(text).trim().length < 40) {
      const reason = sources.map((s) => `${s.filename}: ${s.error}`).join('; ');
      throw badRequest(`Could not read enough text from that upload. ${reason}`.trim());
    }

    const topics = extractTopics(text);
    if (!topics.length) throw badRequest('No topics could be found in that syllabus. Try a file with headings or a bulleted list.');

    const now = new Date();
    const title = String(req.body?.title || '').slice(0, 120)
      || sources[0]?.filename?.replace(/\.(pdf|docx|pptx|txt|md)$/i, '')
      || 'My syllabus';

    const session = {
      userId: toOid(req.userId),
      title,
      source: files.length ? 'upload' : 'paste',
      files: sources,
      // The syllabus text is kept, truncated, so questions can be anchored to
      // what the learner actually uploaded rather than to model memory.
      syllabusText: String(text).slice(0, 400_000),
      topics,
      stats: { answered: 0, correct: 0, topics: topics.length },
      openQuestion: null,
      // A session starts in /learn: the brief asks for personalized teaching to
      // follow diagnosis, and a learner who has just uploaded a syllabus has
      // not been diagnosed yet. `/test` remains one keystroke away.
      mode: null,
      checkState: null,
      createdAt: now,
      updatedAt: now,
    };

    const db = getDb();
    const inserted = await db.collection(SESSIONS).insertOne(session);

    res.status(201).json({
      ok: true,
      session: sessionView({ ...session, _id: inserted.insertedId }),
      files: sources,
      commands: ['/test', '/learn'],
    });
  }),
);

router.get(
  '/tracs',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const sessions = await db
      .collection(SESSIONS)
      .find({ userId: toOid(req.userId) })
      .sort({ updatedAt: -1 })
      .limit(30)
      .toArray();
    res.json({ sessions: sessions.map(sessionView) });
  }),
);

router.get(
  '/tracs/:id',
  asyncHandler(async (req, res) => {
    const session = await loadSession(req.userId, req.params.id);
    res.json({
      session: sessionView(session),
      files: session.files || [],
      // The current question is echoed so a reload resumes mid-conversation
      // rather than dropping the learner back to a blank chat.
      open_question: session.openQuestion || null,
      commands: ['/test', '/learn'],
    });
  }),
);

router.delete(
  '/tracs/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const result = await db.collection(SESSIONS).deleteOne({ _id: toOid(req.params.id), userId: toOid(req.userId) });
    if (!result.deletedCount) throw notFound('That tracs session does not exist.');
    res.json({ ok: true });
  }),
);

/* -------------------------------------------------------------------------- */
/* the two commands                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One chat turn.
 *
 * `POST /api/tracs/:id/turn` takes `{ command: 'test' | 'learn', answer?, … }`.
 * A raw `/test` or `/learn` string is also accepted and parsed, so the browser
 * can send the line the learner typed without re-implementing the parser.
 *
 * Both branches return `{ document, session, state }` — `document` is an
 * ordinary UI document, which is what the answer is rendered from.
 */
router.post(
  '/tracs/:id/turn',
  asyncHandler(async (req, res) => {
    if (!(await isFeatureEnabled('dynamic_ui'))) throw forbidden('Dynamic UI lessons are currently disabled');

    let input = req.body || {};
    // Accept the literal command string, so the client may forward the line as
    // typed. Anything that is not one of the two commands is rejected here.
    if (typeof input.command === 'string' && input.command.startsWith('/')) {
      const parsed = parseCommand(input.command);
      input = { ...input, command: parsed.command };
    }
    const data = validate(turnSchema, input);

    const session = await loadSession(req.userId, req.params.id);
    const topics = session.topics || [];
    const now = new Date();

    /* ---------------------------- /test --------------------------------- */
    if (data.command === 'test') {
      // An answer to the open question, if there is one and it matches. A stale
      // question id is refused rather than mis-graded.
      const open = session.openQuestion;
      if (open && data.answer !== undefined && data.question_id && data.question_id !== open.question.id) {
        throw badRequest('That question has moved on. Answer the one currently on screen.');
      }
      const isAnswer = Boolean(open) && data.answer !== undefined;

      if (isAnswer) {
        const topic = topics.find((t) => t.id === open.topicId) || null;
        const graded = await gradeAnswer({ question: open.question, answer: data.answer, topic, userId: req.userId });

        // --- record the evidence, using the existing engines ---------------
        // "Nothing was actually judged": either this server could not run the
        // code, or the question had no checkable result and it was only
        // smoke-tested. Neither is evidence about the learner.
        const verified = !graded.runtimeUnavailable && !graded.unverified;
        if (topic) {
          const updated = applyAnswerToTopic(topic, { verdict: graded.verdict, verified, now });
          Object.assign(topic, updated);
        }
        session.stats = {
          ...(session.stats || {}),
          answered: (session.stats?.answered || 0) + 1,
          correct: (session.stats?.correct || 0) + (graded.verdict === 'correct' ? 1 : 0),
          topics: topics.length,
        };

        const category = gapCategory({
          question: open.question,
          verdict: graded.verdict,
          runtimeUnavailable: Boolean(graded.runtimeUnavailable) || Boolean(graded.unverified),
        });
        if (category && topic) {
          await recordGap({
            userId: req.userId,
            classroomId: null,
            conceptId: null,
            category,
            description: `${topic.title}: ${graded.misconception || graded.feedback || 'incorrect answer'}`.slice(0, 500),
            descriptionKey: `${topic.id}:${open.question.id}:${graded.verdict}`,
            evidence: String(data.answer ?? '').slice(0, 500),
            evidenceType: 'tracs_answer',
            evidenceRef: String(session._id),
            severity: graded.verdict === 'incorrect' ? 'medium' : 'low',
            confidence: 0.7,
            detectedBy: 'ai',
          }).catch(() => {});
        }
        // A tracs topic is not a classroom concept, so there is no conceptId to
        // record mastery against — `applyMasteryEvidence` needs one and returns
        // early without it. Mastery for a tracs topic is tracked on the topic
        // itself by `applyAnswerToTopic`, which is what the UI reads.
        // Choose what comes next *from this answer*.
        const next = chooseNextTopic(topics, {
          lastTopicId: open.topicId,
          lastVerdict: graded.verdict,
          lastVerified: verified,
          now,
        });

        session.openQuestion = null;

        if (next.reason === 'needs_teaching' && next.topic) {
          // Three misses: stop asking and go and teach it.
          const explanation = await authorExplanation({
            topic: next.topic,
            syllabusExcerpt: excerptFor(session, next.topic),
            userId: req.userId,
            reTeach: true,
          });
          session.mode = 'learn';
          session.teachTopicId = next.topic.id;
          session.pendingChecks = null;
          const checks = await authorChecks({ topic: next.topic, explanation: explanation.document, count: CHECK_COUNT, userId: req.userId, language: languageFor(`${session.syllabusText || ''} ${next.topic.title}`) });
          session.pendingChecks = { topicId: next.topic.id, questions: checks, results: [], startedAt: now.toISOString() };
          await saveSession(session);
          return res.json({
            command: 'test',
            outcome: 'needs_teaching',
            document: mergeDocuments(
              feedbackDocument({ verdict: graded.verdict, feedback: graded.feedback, topic: next.topic, stats: session.stats, commands: false }),
              explanation.document,
              [say('Answer these two checks so I can see whether it landed.')],
              [oneQuestionForm({ question: checks[0], topic: next.topic, index: 1, total: checks.length, sessionId: String(session._id) })],
            ),
            session: sessionView(session),
            result: graded,
          });
        }

        let nextForm = null;
        if (next.topic && next.reason !== 'all_mastered') {
          const question = await authorQuestion({
            topic: next.topic,
            syllabusExcerpt: excerptFor(session, next.topic),
            attempt: (next.topic.attempts || 0) + 1,
            previous: { verdict: graded.verdict, misconception: graded.misconception },
            language: languageFor(`${session.syllabusText || ''} ${next.topic.title}`),
            userId: req.userId,
            conversationId: String(session._id),
          });
          session.openQuestion = { question, topicId: next.topic.id, askedAt: now.toISOString(), reason: next.reason };
          nextForm = oneQuestionForm({
            question,
            topic: next.topic,
            index: null,
            total: null,
            sessionId: String(session._id),
          });
        }

        // The answered question is still in hand here, which is the only place
        // the learner's actual choice and the question's own explanation can be
        // combined into a real account of the mistake.
        const mistake = explainMistake({
          question: session.openQuestion?.question,
          chosen: data.answer,
          verdict: graded.verdict,
        });

        const document = feedbackDocument({
          verdict: graded.verdict,
          feedback: graded.feedback,
          mistake: mistake?.text || null,
          topic: topic || next.topic,
          stats: session.stats,
          nextQuestion: nextForm,
        });
        if (!nextForm) {
          document.components.push(say(next.reason === 'all_mastered'
            ? 'You have mastered every topic in this syllabus. Use `/learn` on any of them to go deeper.'
            : 'There is nothing left to ask right now.'));
        }

        await saveSession(session);
        return res.json({
          command: 'test',
          outcome: next.reason,
          document,
          session: sessionView(session),
          result: graded,
        });
      }

      /* --- no answer: this is "/test" on its own — ask the first question --- */
      const target = data.topic_id
        ? topics.find((t) => t.id === data.topic_id) || null
        : chooseNextTopic(topics, { now }).topic;

      if (!target) {
        await saveSession(session);
        return res.json({
          command: 'test',
          outcome: 'all_mastered',
          document: makeDocument([say('You have mastered every topic in this syllabus. Use `/learn` for a deeper explanation, or upload another syllabus.')]),
          session: sessionView(session),
        });
      }

      const previous = data.topic_id
        ? null
        : (() => {
          const last = session.lastResult;
          return last && last.topicId === target.id ? { verdict: last.verdict, misconception: last.misconception } : null;
        })();

      const question = await authorQuestion({
        topic: target,
        syllabusExcerpt: excerptFor(session, target),
        attempt: (target.attempts || 0) + 1,
        previous,
        language: languageFor(`${session.syllabusText || ''} ${target.title}`),
        userId: req.userId,
        conversationId: String(session._id),
      });

      session.openQuestion = { question, topicId: target.id, askedAt: now.toISOString(), reason: 'started_test' };
      session.mode = 'test';
      await saveSession(session);

      return res.json({
        command: 'test',
        outcome: 'question',
        document: makeDocument([
          say(target.attempts
            ? `Back to **${target.title}** — ${masteryLabel(target).toLowerCase()}. One question at a time.`
            : `Starting with **${target.title}**. One question at a time.`),
          // Deliberately not "of N". One question is asked at a time and the
          // next one depends on the answer, so there is no fixed total to count
          // towards — `topics.length` used to land here and told the learner
          // "question 1 of 14" when they were answering question 1 of 1.
          oneQuestionForm({ question, topic: target, index: 1, total: null, sessionId: String(session._id) }),
        ], { responseType: 'question_form', topic: target.title }),
        session: sessionView(session),
      });
    }

    /* ---------------------------- /learn -------------------------------- */
    const target = data.topic_id
      ? topics.find((t) => t.id === data.topic_id) || null
      : chooseNextTopic(topics, { now, lastTopicId: session.lastResult?.topicId, lastVerdict: session.lastResult?.verdict }).topic;

    if (!target) throw badRequest('This syllabus has no topics left to explain.');

    // If checks are already open on this topic, an answer here is a check
    // answer, not a request for a new explanation.
    const pending = session.pendingChecks;
    const answeringCheck = pending && pending.topicId === target.id && data.answer !== undefined && data.question_id;

    if (answeringCheck) {
      const index = pending.questions.findIndex((q) => q.id === data.question_id);
      if (index === -1) throw badRequest('That check has moved on. Answer the one currently on screen.');
      const question = pending.questions[index];
      const graded = await gradeAnswer({ question, answer: data.answer, topic: target, userId: req.userId });
      pending.results = [...(pending.results || []).filter((r) => r.question_id !== question.id), { question_id: question.id, ...graded }];

      const assessment = assessUnderstanding(pending.results, pending.questions.length);
      // Every check has now been attempted exactly once. If any was missed, stop
      // asking and re-teach — that is the whole point of the checks, and asking
      // an already-answered question a second time would just repeat it.
      const allAttempted = pending.questions.every((q) => pending.results.some((r) => r.question_id === q.id));

      if (!assessment.understood && allAttempted) {
        // Missed the checks: repeat the explanation, differently. The fresh
        // checks run alongside the re-teach rather than after it, for the same
        // reason as a first `/learn` — two sequential model calls is a gateway
        // timeout waiting to happen.
        const [reTeach, fresh] = await Promise.all([
          authorExplanation({
            topic: target,
            syllabusExcerpt: excerptFor(session, target),
            userId: req.userId,
            reTeach: true,
            previous: { components: (session.lastExplanation?.components || []) },
          }),
          authorChecks({ topic: target, explanation: null, count: CHECK_COUNT, userId: req.userId, language: languageFor(`${session.syllabusText || ''} ${target.title}`) }),
        ]);
        const missed = assessment.missed.map((m) => `- ${m.feedback}${m.misconception ? ` (${m.misconception})` : ''}`).join('\n');
        session.pendingChecks = null;
        session.mode = 'learn';
        session.teachTopicId = target.id;
        session.lastExplanation = { components: (reTeach.document.components || []).map((c) => c.type), at: now.toISOString() };

        // A missed check is a gap too — same categories as a wrong /test answer.
        await recordGap({
          userId: req.userId,
          classroomId: null,
          conceptId: null,
          category: 'knowledge_gap',
          description: `${target.title}: understanding not demonstrated after explanation`.slice(0, 500),
          descriptionKey: `${target.id}:learn-check-missed`,
          evidence: missed.slice(0, 500),
          evidenceType: 'tracs_check',
          evidenceRef: String(session._id),
          severity: 'medium',
          confidence: 0.75,
          detectedBy: 'ai',
        }).catch(() => {});

        // Re-check with a fresh set, so the second round tests the re-teach
        // rather than the explanation that just failed.
        session.pendingChecks = { topicId: target.id, questions: fresh, results: [], startedAt: now.toISOString() };

        await saveSession(session);
        return res.json({
          command: 'learn',
          outcome: 'reteach',
          document: makeDocument([
            say(`You got **${assessment.correct} of ${assessment.total}** checks. That is not quite there yet, so here is the explanation again — a different way round this time.`, { tone: 'warning' }),
            ...(reTeach.document.components || []),
            say('Let me check again with fresh questions.'),
            oneQuestionForm({ question: fresh[0], topic: target, index: 1, total: fresh.length, sessionId: String(session._id) }),
          ], { responseType: 'educational_tutorial', topic: target.title }),
          session: sessionView(session),
          assessment,
        });
      }

      if (!assessment.understood) {
        // Still mid-check: ask the next one that has not been answered.
        const nextIndex = pending.questions.findIndex((q) => !pending.results.some((r) => r.question_id === q.id));
        // `findIndex` returns -1 when every question is answered; in that case
        // there is nothing left to ask, and the branch above has already
        // handled it.
        if (nextIndex === -1) {
          await saveSession(session);
          return res.json({
            command: 'learn',
            outcome: 'check',
            document: makeDocument([say('Those checks are done. Use `/test` for a question, or `/learn` to move on.')]),
            session: sessionView(session),
            assessment,
          });
        }
        const question = pending.questions[nextIndex];
        await saveSession(session);
        return res.json({
          command: 'learn',
          outcome: 'check',
          document: makeDocument([
            say(graded.verdict === 'correct'
              ? 'Correct. One more to be sure.'
              : `Not quite. ${graded.feedback}`),
            oneQuestionForm({
              question,
              topic: target,
              index: pending.results.length + 1,
              total: pending.questions.length,
              sessionId: String(session._id),
            }),
          ], { responseType: 'question_form', topic: target.title }),
          session: sessionView(session),
          assessment,
        });
      }

      // Understood.
      session.pendingChecks = null;
      session.stats = { ...(session.stats || {}), topics: topics.length };
      if (target) Object.assign(target, applyAnswerToTopic(target, { verdict: 'correct', now }));
      await saveSession(session);
      return res.json({
        command: 'learn',
        outcome: 'understood',
        document: makeDocument([
          say(`You got all **${assessment.total}** checks. **${target.title}** is understood — that is what matters here.`, { tone: 'success' }),
          say('Use `/test` to try a question on it, or `/learn` for the next topic in your syllabus.'),
        ], { topic: target.title }),
        session: sessionView(session),
        assessment,
      });
    }

    /* --- a fresh /learn: explain, then check --------------------------- */
    // These are two independent model calls and each can take many seconds.
    // Running them in parallel keeps `/learn` inside a serverless gateway's
    // timeout; running them in sequence was a 504 in disguise on a cold start.
    //
    // The checks do lose the explanation's own structure as a hint, so they are
    // authored from the topic instead — which is what `authorChecks` falls back
    // to when it is not given a document, and it still produces answerable
    // questions about the topic just taught.
    // `/learn` explains, and stops there.
    //
    // It used to run the two checking questions as well, in parallel with the
    // explanation. That made /learn feel like /test with a preamble: it always
    // ended in a graded question, so a learner who only wanted to read had to
    // answer one anyway. Now the floor is the explanation plus one way forward —
    // a single `/test` action — and nothing is asked until they choose it.
    const explanation = await authorExplanation({
      topic: target,
      syllabusExcerpt: excerptFor(session, target),
      userId: req.userId,
      reTeach: session.teachTopicId === target.id,
    });

    session.mode = 'learn';
    session.teachTopicId = target.id;
    session.lastExplanation = { components: (explanation.document.components || []).map((c) => c.type), at: now.toISOString() };
    // No checks are pending: /learn no longer opens a checking round.
    session.pendingChecks = null;
    await saveSession(session);

    res.json({
      command: 'learn',
      outcome: 'explained',
      // Exactly one way forward. The explanation arrives with its own action row
      // ("ask a follow-up", "practise", "assessment") which belongs to the tutor
      // flow, not here: in tracs the only two commands are /test and /learn, and
      // after an explanation the useful next move is a question.
      document: mergeDocuments(
        dropComponents(explanation.document, (component) => component.type === 'actions'),
        [{
          id: `next_${Date.now().toString(36)}`,
          type: 'actions',
          title: 'Ready to check?',
          actions: [{ id: 'go_test', label: 'Try a question (/test)', action: 'continue_lesson', command: 'test', tone: 'brand' }],
        }],
      ),
      session: sessionView(session),
      source: explanation.source,
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** The part of the syllabus text that belongs to one topic. */
function excerptFor(session, topic) {
  const text = String(session.syllabusText || '');
  const title = String(topic?.title || '');
  if (!title || !text) return topic?.summary || '';
  const index = text.toLowerCase().indexOf(title.toLowerCase());
  if (index === -1) return `${topic.summary || ''}\n\n${text.slice(0, 1500)}`;
  return text.slice(Math.max(0, index - 200), index + 2500);
}

/** A copy of a document without the components matching `predicate`. */
function dropComponents(document, predicate) {
  if (!document) return document;
  return {
    ...document,
    components: (document.components || []).filter((component) => !predicate(component)),
  };
}

/** Concatenate documents into one, repairing each part as it goes. */
function mergeDocuments(...documents) {
  const components = [];
  for (const document of documents.flat()) {
    if (!document) continue;
    if (Array.isArray(document.components)) components.push(...document.components);
    else components.push(document);
  }
  return makeDocument(components);
}

export default router;
export { tracsSuggestedNextCommands };

function tracsSuggestedNextCommands() {
  return ['/test', '/learn'];
}

// Kept exported for tests that assert the two commands are the only ones the
// surface exposes.
export const COMMANDS = Object.freeze(['/test', '/learn']);
export const _schemas = { z };
