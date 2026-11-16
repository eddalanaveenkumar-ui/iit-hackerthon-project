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
  groupTopicsByUnit,
  syllabusMarkdown,
  questionsPerRound,
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
  localQuestion,
  CHECK_COUNT,
  testRoundForm,
  authorRound,
  diagnoseMistake,
  diagnosisReport,
  DIAGNOSIS_LABELS,
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
    // The unit the learner is working through, and where that unit stands.
    // `selected_unit` drives the UI: before it is set the chat shows the syllabus
    // and asks which unit to study; after it, the chat shows Learn/Test.
    selected_unit: session.selectedUnit || null,
    units: groupTopicsByUnit(session.topics || []).map((unit) => ({
      index: unit.index,
      title: unit.title,
      concepts: unit.concepts,
      // Counted from the concepts themselves so the UI never has to re-derive it.
      attempts: unit.concepts.reduce((n, c) => n + ((session.topics || []).find((t) => t.id === c.id)?.attempts || 0), 0),
      mastery: Math.round(
        unit.concepts.reduce((n, c) => n + ((session.topics || []).find((t) => t.id === c.id)?.mastery || 0), 0)
        / Math.max(1, unit.concepts.length),
      ),
    })),
    round: session.round
      ? {
        number: session.round.number,
        // How many questions this round asks, and — once submitted — how many
        // were right. `total` counts questions, not results: an open round has
        // questions and no results yet, and reporting 0 of 0 read as "you scored
        // nothing" before anything had been answered.
        total: (session.round.questions || []).length || (session.round.results || []).length,
        correct: (session.round.results || []).filter((r) => r.verdict === 'correct').length,
        open: Boolean(session.round.questions?.length) && !(session.round.results || []).length,
      }
      : null,
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

    // The syllabus, as units of concepts, is returned with the session so the
    // client can show it before any chat starts — the learner picks a unit from
    // it rather than being dropped into a question about an arbitrary heading.
    const unitView = groupTopicsByUnit(topics);

    res.status(201).json({
      ok: true,
      session: sessionView({ ...session, _id: inserted.insertedId }),
      files: sources,
      units: unitView,
      syllabus_markdown: syllabusMarkdown(unitView),
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
/* -------------------------------------------------------------------------- */
/* choosing a unit                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The learner picks the unit they want to study.
 *
 * Until this is set the session has no topic context, which is why the chat asks
 * for it rather than guessing: a learner who uploaded a syllabus covering Java
 * and SQL should not be quizzed on SQL because the parser happened to order it
 * first.
 */
router.post(
  '/tracs/:id/unit',
  asyncHandler(async (req, res) => {
    const data = validate(z.object({ unit: z.string().trim().min(1).max(200) }), req.body || {});
    const session = await loadSession(req.userId, req.params.id);
    const units = groupTopicsByUnit(session.topics || []);

    // Match by title, case-insensitively, and also accept "Unit 2".
    const wanted = data.unit.toLowerCase();
    const unit = units.find((u) => u.title.toLowerCase() === wanted)
      || units.find((u) => `unit ${u.index}` === wanted || String(u.index) === wanted);

    if (!unit) throw badRequest('That unit is not in this syllabus. Pick one of the units shown.');

    session.selectedUnit = { title: unit.title, index: unit.index, concepts: unit.concepts.map((c) => c.id) };
    session.round = null;
    session.openQuestion = null;
    session.mode = null;
    await saveSession(session);

    return res.json({
      ok: true,
      unit: { index: unit.index, title: unit.title, concepts: unit.concepts },
      session: sessionView(session),
      // The two things the learner can do with a unit, as the UI's buttons.
      choices: [
        { id: 'learn', label: 'Learn', hint: 'Explain the concepts, then check them', command: 'learn' },
        { id: 'test', label: 'Test', hint: 'Skip the explanation and go straight to questions', command: 'test' },
      ],
    });
  }),
);

/**
 * Build the next round of questions for the selected unit.
 *
 * Called by the turn handler when a unit is chosen, when a round is finished, and
 * after a re-teach. Kept as a function rather than a route so the round state
 * cannot drift from the questions actually shown.
 */
async function startRound(session, { count = null } = {}) {
  const units = groupTopicsByUnit(session.topics || []);
  const selected = session.selectedUnit;
  if (!selected) throw badRequest('Choose a unit first.');

  const concepts = (session.topics || []).filter((t) => (selected.concepts || []).includes(t.id));
  if (!concepts.length) throw badRequest('That unit has no concepts to test.');

  const previousNumber = session.round?.number || 0;
  const number = previousNumber + 1;

  // Rounds after a miss ask more, because the same idea is being probed from more
  // angles; the very first round is short so the learner is not dropped straight
  // into an exam.
  const total = count || questionsPerRound({ concepts: concepts.length, round: number });

  const asked = (session.askedStems || []).slice(-24);
  const early = await authorRound({
    concepts,
    count: total,
    syllabusExcerptFor: (concept) => excerptFor(session, concept),
    sessionText: session.syllabusText || '',
    weakConceptIds: session.round?.missedConceptIds || [],
    avoid: asked,
    userId: session.userId,
    conversationId: String(session._id),
  });

  if (!early.length) {
    // Never fail the turn on this: the learner has just answered a round, and a
    // 400 would throw that away. Fall back to the local bank, which always has
    // something answerable.
    for (const concept of concepts) {
      const fallback = localQuestion(concept, { attempt: 1, language: languageFor(`${session.syllabusText || ''} ${concept.title}`) });
      if (fallback?.question) early.push({ ...fallback, topicId: concept.id, concept: concept.title });
      if (early.length >= Math.min(total, concepts.length)) break;
    }
  }
  if (!early.length) throw badRequest('No questions could be written for that unit. Try another unit.');

  session.round = {
    number,
    // `questions` is replaced by `results` once the learner submits, so an open
    // round means questions awaiting answers.
    questions: early.map((q) => ({ ...q, round: number })),
    results: [],
    missedConceptIds: [],
    startedAt: new Date().toISOString(),
    total,
  };
  session.askedStems = [...(session.askedStems || []), ...early.map((q) => String(q.question || '').slice(0, 120))].slice(-60);
  session.openQuestion = null;
  return { questions: session.round.questions, number, total, unit: units.find((u) => u.title === selected.title) || null };
}

/**
 * The document shown while a round is open: its questions, with the round number
 * and how many concepts it covers.
 */
function roundDocument({ round, unit, questions, intro = null }) {
  const components = [];
  if (intro) components.push(say(intro));
  components.push(say(
    `**Round ${round}** — ${questions.length} question${questions.length === 1 ? '' : 's'} across ${unit?.concepts?.length || 1} concept${(unit?.concepts?.length || 1) === 1 ? '' : 's'} in **${unit?.title || 'this unit'}**. Answer them all, then submit once.`,
  ));
  components.push(testRoundForm({ questions, topic: { title: unit?.title || 'Test' }, sessionId: 'round' }));
  return makeDocument(components, { responseType: 'assessment', topic: unit?.title || '' });
}

/* -------------------------------------------------------------------------- */
/* the unit loop: learn → test → diagnose → retest                            */
/* -------------------------------------------------------------------------- */

/**
 * Grade a submitted round, diagnose every miss, and decide what comes next.
 *
 * The loop the brief asks for:
 *
 *   - every miss is named as a knowledge gap, a misconception or a practical
 *     difficulty, and explained cleanly;
 *   - the unit is then retested with *new* questions, not the ones just missed;
 *   - this repeats until every question in a round is right;
 *   - in test mode the explanation step is skipped entirely and the learner goes
 *     straight back into questions.
 *
 * Grading is per question, in parallel, and each result keeps the question it
 * belongs to so nothing is attributed to the wrong concept.
 */
async function gradeRound(session, submitted = []) {
  const open = session.round?.questions || [];
  if (!open.length) throw badRequest('There is no round open. Choose Learn or Test to start one.');

  const byId = new Map(open.map((q) => [q.id, q]));
  // Unknown ids are ignored rather than failing the whole submission: a stale tab
  // should not lose the answers that are still valid.
  const paired = submitted
    .map((a) => ({ question: byId.get(String(a.question_id)), value: a.value }))
    .filter((p) => p.question);

  if (!paired.length) throw badRequest('None of those answers match the questions on screen.');

  const graded = await Promise.all(paired.map(async ({ question, value }) => {
    const topic = (session.topics || []).find((t) => t.id === question.topicId) || null;
    const result = await gradeAnswer({ question, answer: value, topic, userId: session.userId });
    const verified = !result.runtimeUnavailable && !result.unverified;
    return {
      question_id: question.id,
      question,
      topicId: question.topicId,
      answer: value,
      ...result,
      verified,
      diagnosis: diagnoseMistake({ question, verdict: result.verdict, chosen: value, graded: result, runtimeUnavailable: Boolean(result.runtimeUnavailable) }),
    };
  }));

  // Record the evidence the same way a single answer did, so gaps and mastery
  // keep flowing into the existing engines.
  const now = new Date();
  for (const result of graded) {
    const topic = (session.topics || []).find((t) => t.id === result.topicId) || null;
    if (topic && result.verified) Object.assign(topic, applyAnswerToTopic(topic, { verdict: result.verdict, verified: true, now }));
    const category = gapCategory({ question: result.question, verdict: result.verdict, runtimeUnavailable: !result.verified });
    if (category && topic) {
      await recordGap({
        userId: session.userId,
        classroomId: null,
        conceptId: null,
        category,
        description: `${topic.title}: ${result.misconception || result.feedback || 'incorrect answer'}`.slice(0, 500),
        descriptionKey: `${topic.id}:${result.question_id}:${result.verdict}`,
        evidence: String(result.answer ?? '').slice(0, 500),
        evidenceType: 'tracs_answer',
        evidenceRef: String(session._id),
        severity: result.verdict === 'incorrect' ? 'medium' : 'low',
        confidence: 0.7,
        detectedBy: 'ai',
      }).catch(() => {});
    }
  }

  session.stats = {
    ...(session.stats || {}),
    answered: (session.stats?.answered || 0) + graded.length,
    correct: (session.stats?.correct || 0) + graded.filter((r) => r.verdict === 'correct').length,
    topics: (session.topics || []).length,
  };

  /**
   * What counts as a miss.
   *
   * Only answers the server could actually judge, and which came back wrong.
   * `partly_correct` is what an open-text answer gets when no model is available
   * to mark it — the local evaluator records it and says plainly that it was not
   * graded against a reference answer. Treating that as a miss told learners
   * their correct explanation was a knowledge gap, and would have retested them
   * forever over answers nothing had actually judged.
   */
  const judgedWrong = (r) => r.verified && (r.verdict === 'incorrect' || r.verdict === 'unanswered');
  const misses = graded.filter((r) => judgedWrong(r) && r.diagnosis?.category);
  const unjudged = graded.filter((r) => !r.verified || r.verdict === 'partly_correct' || r.verdict === 'not_graded');
  return { graded, misses, unjudged, passed: misses.length === 0 };
}

/**
 * What to say after a round, and what to do next.
 *
 * A clean round ends the loop ("all right — take the next unit or go deeper").
 * A round with misses produces the categorised breakdown, and then either a
 * re-teach (learn mode) or straight back into fresh questions (test mode).
 */
async function finishRound(session, { mode, graded, misses, unjudged = [], passed }) {
  const unitTitle = session.selectedUnit?.title || 'this unit';
  const report = diagnosisReport({ results: graded, questions: session.round.questions });

  session.round.results = graded;
  session.round.finishedAt = new Date().toISOString();
  session.round.missedConceptIds = [...new Set(misses.map((m) => m.topicId).filter(Boolean))];

  if (passed) {
    const noted = unjudged.length
      ? ` ${unjudged.length} open answer${unjudged.length === 1 ? '' : 's'} could not be marked automatically and ${unjudged.length === 1 ? 'is' : 'are'} not counted against you.`
      : '';
    const components = [
      say(`**All ${graded.length} correct.** ${unitTitle} is holding up under questions — that is evidence, not a feeling.${noted}`),
    ];
    // Mark every concept in the unit as demonstrated so the syllabus view and the
    // mastery labels reflect what just happened.
    for (const conceptId of session.selectedUnit?.concepts || []) {
      const topic = (session.topics || []).find((t) => t.id === conceptId);
      if (topic) Object.assign(topic, applyAnswerToTopic(topic, { verdict: 'correct', verified: true, now: new Date() }));
    }
    // Cleared so the next turn is a fresh request (a new round, or another unit)
    // rather than a resubmission of the round that just passed.
    session.round = null;
    session.mode = null;
    session.openQuestion = null;
    components.push({
      id: `unit_done_${Date.now().toString(36)}`,
      type: 'actions',
      title: 'What next',
      actions: [
        { id: 'next_unit', label: 'Choose another unit', action: 'open_practice', tone: 'primary' },
        { id: 'again', label: 'Test this unit harder', action: 'continue_lesson', command: 'test' },
      ],
    });
    return makeDocument(components, { responseType: 'progress_summary', topic: unitTitle });
  }

  const components = [
    say(`**${graded.length - misses.length} of ${graded.length} correct.** Not done yet — here is exactly what went wrong.`),
    ...report.components,
  ];

  if (mode === 'learn') {
    // Re-teach the concepts that were missed, then retest. The explanation is
    // authored per missed concept rather than for the whole unit so it addresses
    // what the round actually found.
    const missedTopics = [...new Set(misses.map((m) => m.topicId))];
    const explanations = await Promise.all(missedTopics.map((id) => {
      const topic = (session.topics || []).find((t) => t.id === id);
      if (!topic) return null;
      return authorExplanation({
        topic,
        syllabusExcerpt: excerptFor(session, topic),
        userId: session.userId,
        reTeach: true,
      }).then((r) => ({ topic, document: r.document })).catch(() => null);
    }));

    for (const item of explanations) {
      if (!item) continue;
      components.push(say(`### ${item.topic.title}`));
      components.push(...(item.document.components || []));
    }
  }

  // The retest: fresh questions, same unit, biased to what was missed. Authored
  // before responding so the learner is not left waiting on a second round trip.
  const { questions, number } = await startRound(session);
  session.mode = mode;
  components.push(say(
    mode === 'learn'
      ? 'That is the idea again, from a different angle. Now the same concepts come back as **new questions** — nothing above is repeated.'
      : 'Back to questions. These are **new questions on the same concepts**, aimed at the steps that just went wrong.',
  ));
  components.push(testRoundForm({ questions, topic: { title: unitTitle }, sessionId: 'retest' }));

  return makeDocument(components, { responseType: 'educational_tutorial', topic: unitTitle, round: number });
}

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

    /* ---------------- the unit loop: submit a whole round --------------- */
    // A submitted round is graded as a set, diagnosed, and followed by either a
    // re-teach (learn) or a fresh retest (test). This sits in front of the old
    // single-question flow so both paths share one session and one set of
    // evidence writes.
    if (Array.isArray(data.answers) && data.answers.length) {
      const mode = data.command;
      if (!session.selectedUnit) throw badRequest('Choose a unit before answering questions.');
      const outcome = await gradeRound(session, data.answers);
      const document = await finishRound(session, { mode, ...outcome });
      await saveSession(session);
      return res.json({
        command: mode,
        outcome: outcome.passed ? 'unit_passed' : 'round_diagnosed',
        document,
        session: sessionView(session),
        diagnosis: {
          total: outcome.graded.length,
          correct: outcome.graded.length - outcome.misses.length,
          misses: outcome.misses.map((m) => ({
            question: m.question.question,
            category: m.diagnosis.category,
            label: m.diagnosis.label,
            chosen: m.answer,
            detail: m.diagnosis.detail,
          })),
        },
      });
    }

    /* ------------------- learn / test on the selected unit -------------- */
    // "Learn" explains the unit's concepts and then tests; "Test" goes straight
    // to questions. Both are the same command surface the chat already had.
    if (data.answer === undefined && session.selectedUnit && !session.round?.results?.length) {
      const unit = groupTopicsByUnit(topics).find((u) => u.title === session.selectedUnit.title) || null;

      if (data.command === 'learn') {
        const concepts = topics.filter((t) => (session.selectedUnit.concepts || []).includes(t.id));
        const [explanation] = await Promise.all([
          authorExplanation({
            topic: { ...concepts[0], title: unit?.title || concepts[0]?.title, summary: concepts.map((c) => `${c.title}: ${c.summary}`).join('\n') },
            syllabusExcerpt: concepts.map((c) => excerptFor(session, c)).join('\n\n').slice(0, 4000),
            userId: req.userId,
          }),
        ]);
        const { questions, number } = await startRound(session);
        session.mode = 'learn';
        const document = makeDocument([
          say(`**${unit?.title || 'This unit'}** — here is the idea from the ground up, then questions on it.`),
          ...(explanation.document.components || []),
          say(`Now let us see what stuck. **Round ${number}** — ${questions.length} questions across this unit.`),
          testRoundForm({ questions, topic: { title: unit?.title || 'Test' }, sessionId: 'learn' }),
        ], { responseType: 'educational_tutorial', topic: unit?.title || '' });
        await saveSession(session);
        return res.json({ command: 'learn', outcome: 'explained', document, session: sessionView(session) });
      }

      // Test mode: no explanation. Straight into the round.
      const { questions, number } = await startRound(session);
      session.mode = 'test';
      const document = roundDocument({
        round: number,
        unit,
        questions,
        intro: `**${unit?.title || 'This unit'}** — straight to questions. No explanation, that is the point of Test.`,
      });
      await saveSession(session);
      return res.json({ command: 'test', outcome: 'question', document, session: sessionView(session) });
    }

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
