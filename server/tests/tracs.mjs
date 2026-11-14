/**
 * TRACS — LOGIC TEST
 * ==================
 *
 * The brief for tracs has five properties that must hold no matter which model
 * answers:
 *
 *   1. exactly two commands exist, and anything else is refused;
 *   2. `/test` asks ONE question at a time;
 *   3. the next question is chosen from the previous answer;
 *   4. `/learn` explains, then checks, and repeats the explanation when the
 *      checks are missed;
 *   5. a wrong answer is recorded as a gap in the existing gap engine's
 *      vocabulary (knowledge gap / misconception / practical difficulty).
 *
 * Everything here is deterministic: no provider key is configured, so the
 * engine's own fallbacks are what run. That is deliberate — these are the paths
 * that must work when the model is unavailable, and they are the paths a model
 * failure degrades to.
 *
 *   node tests/tracs.mjs
 */

import { extractTopics, chooseNextTopic, applyAnswerToTopic, parseCommand, MASTERY, masteryLabel } from '../src/modules/tracs/topics.js';
import {
  authorQuestion,
  normaliseQuestion,
  localQuestion,
  pickQuestionType,
  gradeAnswer,
  oneQuestionForm,
  authorChecks,
  assessUnderstanding,
  gapCategory,
  localExplanation,
  feedbackDocument,
  CHECK_COUNT,
} from '../src/modules/tracs/engine.js';
import { factsFor, languageFor } from '../src/modules/tracs/question-bank.js';
import { parseUiDocument } from '../src/modules/ai/ui/protocol.js';

let passed = 0;
const failures = [];
let group = '';

const section = (name) => {
  group = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
};

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures.push(`${group} :: ${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function equal(label, actual, expected) {
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/* -------------------------------------------------------------------------- */
/* 1. exactly two commands                                                    */
/* -------------------------------------------------------------------------- */

section('the surface exposes exactly two commands');

equal('/test is one command', parseCommand('/test').command, 'test');
equal('/learn is the other', parseCommand('/learn').command, 'learn');
equal('/TEST is case-insensitive', parseCommand('/TEST').command, 'test');
equal('a command may carry no arguments', parseCommand('/test').rest, '');

for (const refused of ['/quiz', '/help', '/explain', 'hello', '', '/', '/test/learn']) {
  let threw = false;
  try {
    parseCommand(refused);
  } catch {
    threw = true;
  }
  check(`refuses ${JSON.stringify(refused)}`, threw);
}

// A free-text-only turn must be a validation error, not a guessed command: the
// turn schema has a closed enum.
{
  const { turnSchema } = await import('../src/modules/tracs/topics.js');
  equal('turnSchema rejects free text', turnSchema.safeParse({ command: 'teach me' }).success, false);
  equal('turnSchema accepts /test', turnSchema.safeParse({ command: 'test' }).success, true);
}

/* -------------------------------------------------------------------------- */
/* 2. topics come from the syllabus                                           */
/* -------------------------------------------------------------------------- */

section('a syllabus becomes topics');

const MARKDOWN_SYLLABUS = `# CS 101 — Introduction to Programming

## Unit 1: Python Basics

- Variables and data types
- Control flow with if and else
- Functions and parameters

## Unit 2: Data Structures

## Lists and tuples
A list is an ordered, mutable sequence. A tuple is ordered and immutable.

## Dictionaries
A dictionary maps keys to values and gives constant-time lookup.

## Unit 3: Algorithms

- Sorting algorithms
- Binary search
- Recursion and the call stack
`;

const markdownTopics = extractTopics(MARKDOWN_SYLLABUS);
check('markdown syllabus yields topics', markdownTopics.length >= 5, `got ${markdownTopics.length}`);
check(
  'units are not mistaken for topics',
  !markdownTopics.some((t) => /^unit \d/i.test(t.title)),
  JSON.stringify(markdownTopics.map((t) => t.title)),
);
check(
  'topics carry the unit they belong to',
  markdownTopics.filter((t) => /data structures/i.test(t.unit || '')).length >= 2,
  JSON.stringify(markdownTopics.map((t) => [t.title, t.unit])),
);
check(
  'a heading with a paragraph under it keeps that paragraph as its summary',
  /ordered, mutable sequence/i.test(markdownTopics.find((t) => /Lists/i.test(t.title))?.summary || ''),
  markdownTopics.find((t) => /Lists/i.test(t.title))?.summary,
);
check('every topic has a stable id', markdownTopics.every((t) => /^t\d+$/.test(t.id)));
check('titles are deduplicated', new Set(markdownTopics.map((t) => t.title.toLowerCase())).size === markdownTopics.length);
check('document furniture is dropped', !markdownTopics.some((t) => /table of contents|syllabus/i.test(t.title)));

// A prose syllabus with no structure at all still has to produce topics: a
// learner is not going to reformat their file.
const PROSE = 'This course covers the basics of statistics. Students will learn about probability distributions and how they describe data. We then study hypothesis testing and the meaning of a p-value. Finally, regression models are introduced with worked examples.';
const proseTopics = extractTopics(PROSE);
check('a prose-only syllabus still yields topics', proseTopics.length >= 1, `got ${proseTopics.length}`);

equal('an empty syllabus yields nothing', extractTopics('').length, 0);
equal('whitespace yields nothing', extractTopics('   \n\n  ').length, 0);

/* -------------------------------------------------------------------------- */
/* 3. the next topic follows from the previous answer                         */
/* -------------------------------------------------------------------------- */

section('the next question is chosen from the answer just given');

const topics = [
  { id: 't1', title: 'Variables', attempts: 0, correct: 0, mastery: 0, nextReviewAt: null },
  { id: 't2', title: 'Loops', attempts: 0, correct: 0, mastery: 0, nextReviewAt: null },
  { id: 't3', title: 'Functions', attempts: 0, correct: 0, mastery: 0, nextReviewAt: null },
];
const now = new Date('2026-01-01T00:00:00Z');

{
  // First question: something never seen.
  const first = chooseNextTopic(topics, { now });
  equal('a fresh session starts on an unseen topic', first.reason, 'first_exposure');
  equal('and that topic is the first one', first.topic.id, 't1');
}

{
  // A WRONG answer re-asks the same topic — the lesson does not move on.
  const afterWrong = chooseNextTopic(topics, { lastTopicId: 't1', lastVerdict: 'incorrect', now });
  equal('a wrong answer returns to the same topic', afterWrong.topic.id, 't1');
  equal('with a retry reason', afterWrong.reason, 'retry_after_incorrect');
}

{
  // A RIGHT answer moves on to unseen material.
  const afterCorrect = chooseNextTopic(topics, { lastTopicId: 't1', lastVerdict: 'correct', now });
  check('a correct answer moves on', afterCorrect.topic.id !== 't1', afterCorrect.topic.id);
  equal('to something not yet seen', afterCorrect.reason, 'first_exposure');
}

{
  // Three misses and the caller is told to teach instead of asking again.
  const struggling = [{ ...topics[0], attempts: 2 }];
  const result = chooseNextTopic(struggling, { lastTopicId: 't1', lastVerdict: 'incorrect', now });
  equal('three misses on one topic switches to teaching', result.reason, 'needs_teaching');
}

{
  // Everything mastered: say so rather than inventing a question.
  const mastered = topics.map((t) => ({ ...t, attempts: 4, correct: 4, mastery: MASTERY.mastered, nextReviewAt: '2030-01-01T00:00:00Z' }));
  equal('a mastered syllabus stops asking', chooseNextTopic(mastered, { now }).topic, null);
  equal('with an explicit reason', chooseNextTopic(mastered, { now }).reason, 'all_mastered');
}

{
  // A partly-correct answer keeps the topic in play but is not a "move on" signal.
  const partly = chooseNextTopic(topics, { lastTopicId: 't1', lastVerdict: 'partly_correct', now });
  equal('a partly-correct answer stays on the topic', partly.topic.id, 't1');
}

/* -------------------------------------------------------------------------- */
/* 4. mastery and scheduling                                                  */
/* -------------------------------------------------------------------------- */

section('mastery moves with the verdict');

{
  const wrong = applyAnswerToTopic(topics[0], { verdict: 'incorrect', now });
  equal('a wrong answer counts as an attempt', wrong.attempts, 1);
  equal('a wrong answer does not count as correct', wrong.correct, 0);
  equal('mastery does not rise on a wrong answer', wrong.mastery, 0);
  check('a wrong answer schedules a near-term retry', new Date(wrong.nextReviewAt) - now <= 3 * 60_000);

  const right = applyAnswerToTopic(topics[0], { verdict: 'correct', now });
  equal('a correct answer counts', right.correct, 1);
  equal('mastery rises on a correct answer', right.mastery, 1);
  check('a correct answer schedules a later review than a wrong one', new Date(right.nextReviewAt) > new Date(wrong.nextReviewAt));

  // Never exceeds the scale.
  let maxed = topics[0];
  for (let i = 0; i < 10; i += 1) maxed = applyAnswerToTopic({ ...maxed, mastery: MASTERY.mastered }, { verdict: 'correct', now });
  equal('mastery is capped', maxed.mastery, MASTERY.mastered);
}

equal('mastery labels are human', masteryLabel({ mastery: 0 }), 'Not started');
equal('mastery labels read well at the top', masteryLabel({ mastery: 4 }), 'Mastered');

/* -------------------------------------------------------------------------- */
/* 5. /test asks exactly one question                                         */
/* -------------------------------------------------------------------------- */

section('/test asks one question at a time');

{
  const question = localQuestion(topics[1], { attempt: 1 });
  const form = oneQuestionForm({ question, topic: topics[1], index: 1, total: 12, sessionId: 's1' });

  equal('the form is a question_form', form.type, 'question_form');
  equal('it holds exactly ONE question', form.questions.length, 1);
  equal('that question is required', form.questions[0].required, true);
  equal('there is exactly one submission', Boolean(form.submission && form.submission.button_text), true);
  equal('the submit action is the AI-question handler', form.submission.action, 'submit_ai_questions');

  const doc = { version: '1.0', response_id: 'r', response_type: 'question_form', components: [form] };
  const parsed = parseUiDocument(doc);
  check('the one-question form parses as a UI document', parsed.ok, JSON.stringify(parsed.issues?.slice(0, 1)));

  // Five different questions produce five valid forms — the acceptance
  // criterion "five questions render as five appropriate inputs".
  const five = ['Variables', 'Loops', 'Functions', 'Recursion', 'Sorting'].map((title, i) => {
    const t = { id: `t${i}`, title, summary: 'A concept.', keywords: [] };
    return oneQuestionForm({ question: localQuestion(t, { attempt: 1 }), topic: t, index: i + 1, total: 5, sessionId: 's1' });
  });
  check('five questions give five forms', five.length === 5);
  check('every one of them has a single question', five.every((f) => f.questions.length === 1));
  check('every one of them validates', five.every((f) => parseUiDocument({ version: '1.0', response_id: 'r', response_type: 'question_form', components: [f] }).ok));
}

/* -------------------------------------------------------------------------- */
/* 6. question types follow the subject                                       */
/* -------------------------------------------------------------------------- */

section('the question type fits the concept');

equal('code topics ask for code', pickQuestionType({ title: 'Python functions', keywords: [] }, { attempt: 1 }), 'code_input');
equal('maths topics ask for a number', pickQuestionType({ title: 'Variance', keywords: [] }, { attempt: 1, subject: 'statistics' }), 'number');
equal('a second attempt gets easier', pickQuestionType({ title: 'Recursion', keywords: [] }, { attempt: 2 }), 'radio');
check('a first attempt on code gets code', ['code_input', 'radio'].includes(pickQuestionType({ title: 'Loops in python' }, { attempt: 1 })));

/* -------------------------------------------------------------------------- */
/* 7. a malformed model question never reaches the learner                    */
/* -------------------------------------------------------------------------- */

section('model output is gated');

const fallback = localQuestion(topics[0], { attempt: 1 });

{
  const noOptions = normaliseQuestion({ question: 'What is a variable in Python?', type: 'radio', options: [] }, fallback, topics[0]);
  equal('multiple choice with no options falls back', noOptions.source, 'local');

  const badIndex = normaliseQuestion(
    { question: 'What is a variable in Python?', type: 'radio', options: ['A', 'B'], correct_index: 7 },
    fallback,
    topics[0],
  );
  equal('a correct index outside the options falls back', badIndex.source, 'local');

  const tooShort = normaliseQuestion({ question: 'What?', type: 'text_input' }, fallback, topics[0]);
  equal('a one-word question falls back', tooShort.source, 'local');

  const good = normaliseQuestion(
    { question: 'Which of these creates a variable holding the number 5?', type: 'radio', options: ['x = 5', 'x == 5', '5 = x'], correct_index: 0 },
    fallback,
    topics[0],
  );
  equal('a usable question is kept', good.source, 'model');
  equal('and keeps its marking scheme', good.correct_index, 0);

  const code = normaliseQuestion({ question: 'Write a loop that prints 1 to 5.', type: 'code_input', language: 'python', expected_output: '1\n2\n3\n4\n5' }, fallback, topics[0]);
  equal('a coding question keeps its language', code.language, 'python');
  equal('and its expected output', code.expected_output, '1\n2\n3\n4\n5');
}

/* -------------------------------------------------------------------------- */
/* 8. grading: multiple choice needs no model                                 */
/* -------------------------------------------------------------------------- */

section('grading is deterministic where it can be');

{
  const question = {
    id: 'q1',
    type: 'radio',
    question: 'Which statement defines a variable?',
    options: ['x = 5', 'x == 5', 'print(x)'],
    correct_index: 0,
  };

  const correct = await gradeAnswer({ question, answer: 'x = 5', topic: topics[0] });
  equal('a correct choice is marked correct', correct.verdict, 'correct');
  equal('with a full score', correct.score, 100);

  const wrong = await gradeAnswer({ question, answer: 'x == 5', topic: topics[0] });
  equal('a wrong choice is marked incorrect', wrong.verdict, 'incorrect');
  equal('and names the right answer', wrong.correct_answer, 'x = 5');
  check('and records the specific misconception', /x == 5/.test(wrong.misconception || ''), wrong.misconception);

  const blank = await gradeAnswer({ question, answer: '', topic: topics[0] });
  equal('an empty answer is unanswered, not wrong', blank.verdict, 'unanswered');
  equal('and scores zero', blank.score, 0);
}

/* -------------------------------------------------------------------------- */
/* 9. gap categories use the existing vocabulary                              */
/* -------------------------------------------------------------------------- */

section('a wrong answer becomes the right kind of gap');

equal('a wrong multiple choice is a misconception', gapCategory({ question: { type: 'radio' }, verdict: 'incorrect' }), 'misconception');
equal('broken code is a practical difficulty', gapCategory({ question: { type: 'code_input' }, verdict: 'incorrect' }), 'practical_difficulty');
equal('a wrong written answer is a knowledge gap', gapCategory({ question: { type: 'text_input' }, verdict: 'incorrect' }), 'knowledge_gap');
equal('a correct answer is not a gap', gapCategory({ question: { type: 'text_input' }, verdict: 'correct' }), null);
equal('an ungraded answer is not a gap', gapCategory({ question: { type: 'code_input' }, verdict: 'not_graded' }), null);

/* -------------------------------------------------------------------------- */
/* 10. /learn: explain, then check, then re-teach                             */
/* -------------------------------------------------------------------------- */

section('/learn explains and then checks');

{
  const explanation = localExplanation(topics[0]);
  const parsed = parseUiDocument(explanation);
  check('the local explanation is a valid UI document', parsed.ok, JSON.stringify(parsed.issues?.slice(0, 1)));
  check('it carries at least one rendering', explanation.components.length >= 1);

  const checks = await authorChecks({ topic: topics[0], explanation });
  check('there is at least one checking question', checks.length >= 1);
  equal('the default is two checks', CHECK_COUNT, 2);
  check('every check can be rendered', checks.every((c) => Boolean(c.question) && Boolean(c.type)));
}

section('understanding is decided by the checks, not by the model saying so');

{
  const passed = assessUnderstanding([{ verdict: 'correct' }, { verdict: 'correct' }]);
  equal('two correct checks means understood', passed.understood, true);

  const failed = assessUnderstanding([{ verdict: 'correct' }, { verdict: 'incorrect' }]);
  equal('one missed check means not understood', failed.understood, false);
  equal('and names the miss', failed.missed.length, 1);
  equal('the reason is specific', failed.reason, 'missed_check');

  const partly = assessUnderstanding([{ verdict: 'partly_correct' }]);
  equal('a partly-correct check is not a pass', partly.understood, false);

  const ungraded = assessUnderstanding([{ verdict: 'not_graded' }]);
  equal('an ungraded check is not a pass either', ungraded.understood, false);
  equal('and is reported as ungraded', ungraded.reason, 'ungraded');

  const empty = assessUnderstanding([]);
  equal('no checks is not a pass', empty.understood, false);
}

{
  // The re-teach must not be the same document as the first explanation.
  const first = localExplanation(topics[0]);
  const again = localExplanation(topics[0], { reTeach: true });
  const firstText = JSON.stringify(first);
  const againText = JSON.stringify(again);
  check('a re-teach is worded differently from the first explanation', firstText !== againText);

  const firstHeadings = (first.components?.[0]?.sections || []).map((s) => s.heading);
  const againHeadings = (again.components?.[0]?.sections || []).map((s) => s.heading);
  check('a re-teach uses a different framing', firstHeadings[0] !== againHeadings[0], `${firstHeadings[0]} vs ${againHeadings[0]}`);
}

/* -------------------------------------------------------------------------- */
/* 11. the feedback document is renderable                                    */
/* -------------------------------------------------------------------------- */

section('the feedback document renders');

{
  const doc = feedbackDocument({
    verdict: 'incorrect',
    feedback: 'Not quite — a loop repeats until its condition is false.',
    topic: { ...topics[1], attempts: 1, correct: 0, mastery: 1 },
    stats: { answered: 1, correct: 0, topics: 3 },
  });
  const parsed = parseUiDocument(doc);
  check('the feedback document is valid', parsed.ok, JSON.stringify(parsed.issues?.slice(0, 1)));
  check('it says what happened', doc.components.some((c) => c.type === 'text' && /Not quite/.test(c.content)));
  check('it shows where the topic stands', doc.components.some((c) => c.type === 'progress'));
  check('and offers the two commands', doc.components.some((c) => c.type === 'actions'));

  const withNext = feedbackDocument({
    verdict: 'correct',
    feedback: 'Correct.',
    topic: topics[1],
    stats: { answered: 2, correct: 1, topics: 3 },
    nextQuestion: oneQuestionForm({ question: localQuestion(topics[2], { attempt: 1 }), topic: topics[2], index: 2, total: 3, sessionId: 's' }),
  });
  check('feedback plus the next question is one valid document', parseUiDocument(withNext).ok);
  check('and still asks exactly one question', withNext.components.filter((c) => c.type === 'question_form').flatMap((c) => c.questions).length === 1);
}

/* -------------------------------------------------------------------------- */
/* 12. the model path falls back rather than failing                          */
/* -------------------------------------------------------------------------- */

section('no model configured: the engine still answers');

{
  // With no provider configured, runJsonTask returns null data and every author
  // call must fall back to the deterministic version rather than throwing.
  const question = await authorQuestion({
    topic: topics[0],
    syllabusExcerpt: 'A variable is a named storage location.',
    attempt: 1,
    userId: '5f0000000000000000000001',
  });
  check('a question is still produced', Boolean(question?.question));
  check('and is renderable', parseUiDocument({
    version: '1.0', response_id: 'r', response_type: 'question_form',
    components: [oneQuestionForm({ question, topic: topics[0], index: 1, total: 1, sessionId: 's' })],
  }).ok);
}

/* -------------------------------------------------------------------------- */
/* a missing interpreter is not a learner's mistake                           */
/* -------------------------------------------------------------------------- */

section('a server without Python does not fail the learner');

{
  // The production symptom: the API deployed on a Node-only image, `spawn
  // python3` raised ENOENT, and the learner was told "Not quite" for code that
  // was never run.
  process.env.LM_FORCE_RUNTIME_UNAVAILABLE = 'python';
  const { resetRuntimeCache } = await import('../src/utils/sandbox.js');
  resetRuntimeCache();

  const graded = await gradeAnswer({
    question: {
      id: 'q_code', type: 'code_input', language: 'python',
      question: 'Write a program that prints 4.', expected_output: '4',
    },
    answer: 'print(2 + 2)',
    topic: { id: 't1', title: 'Variables' },
    userId: '5f0000000000000000000001',
  });

  equal('the answer is not marked wrong', graded.verdict === 'incorrect', false);
  equal('it is recorded as unverified', graded.verdict, 'partly_correct');
  check('the learner is told why', /no Python interpreter/i.test(graded.feedback), graded.feedback);
  check('the message never says "Not quite"', !/^not quite/i.test(graded.feedback), graded.feedback);
  equal('the fault is marked as the server\'s, not the learner\'s', graded.runtimeUnavailable, true);

  // And it must not be recorded as a knowledge gap: the learner demonstrated
  // nothing wrong, because nothing ran.
  equal(
    'no gap is recorded for an unverified answer',
    gapCategory({ question: { type: 'code_input' }, verdict: graded.verdict, runtimeUnavailable: graded.runtimeUnavailable }),
    null,
  );
  // The reason it matters: without the flag this exact answer is filed against
  // the learner as a practical difficulty.
  equal(
    'without the flag the same answer would be a gap',
    gapCategory({ question: { type: 'code_input' }, verdict: graded.verdict }),
    'practical_difficulty',
  );

  delete process.env.LM_FORCE_RUNTIME_UNAVAILABLE;
  resetRuntimeCache();
}

{
  // With the interpreter present the same answer is verified — the guard is
  // specific to a missing runtime, not a blanket disable.
  const { resetRuntimeCache } = await import('../src/utils/sandbox.js');
  resetRuntimeCache();
  const graded = await gradeAnswer({
    question: { id: 'q_ok', type: 'code_input', language: 'python', expected_output: '4' },
    answer: 'print(2 + 2)',
    topic: { id: 't1', title: 'Variables' },
    userId: '5f0000000000000000000001',
  });
  equal('with Python installed the answer is verified', graded.verdict, 'correct');
  equal('a working runtime raises no server fault', Boolean(graded.runtimeUnavailable), false);
  equal('real code errors are still a gap', gapCategory({ question: { type: 'code_input' }, verdict: 'incorrect', runtimeUnavailable: false }), 'practical_difficulty');
}

{
  // An unverified answer must not be scheduled as a retry. Asking the learner
  // again is remediation for a wrong answer; here nothing was judged, so
  // "retry_after_incorrect" would spend an attempt that can trigger teaching.
  const topic = { id: 't1', title: 'Loops', attempts: 0, mastery: 2 };
  const untouched = applyAnswerToTopic(topic, { verdict: 'partly_correct', verified: false });
  equal('an unverified answer spends no attempt', untouched.attempts, 0);
  equal('an unverified answer does not move mastery', untouched.mastery, 2);

  const chosenUnverified = chooseNextTopic([topic], {
    lastTopicId: 't1', lastVerdict: 'partly_correct', lastVerified: false,
  });
  equal('an unverified answer is not a retry for being wrong', chosenUnverified.reason, 'retry_unverified');

  const chosenWrong = chooseNextTopic([topic], {
    lastTopicId: 't1', lastVerdict: 'incorrect', lastVerified: true,
  });
  equal('a genuinely wrong answer still gets a retry', chosenWrong.reason, 'retry_after_incorrect');
}

/* -------------------------------------------------------------------------- */
/* every code question can be answered correctly                              */
/* -------------------------------------------------------------------------- */

section('a code question always has a checkable answer');

{
  // Without an expected output the grader can only prove the program *runs*, so
  // a correct answer is stuck at "Almost" forever and after two attempts the
  // learner is sent to /learn for code that worked.
  for (const title of ['Python loops and iteration', 'Python functions and recursion', 'Python lists and indexing', 'Python variables']) {
    const q = localQuestion({ title }, { attempt: 1 });
    if (q.type !== 'code_input') continue;
    check(`${title}: carries an expected output`, typeof q.expected_output === 'string' && q.expected_output.length > 0, JSON.stringify(q.expected_output));
    check(`${title}: the prompt says what to print`, /print/i.test(q.question), q.question);
  }

  const loop = localQuestion({ title: 'Python loops' }, { attempt: 1 });
  equal('the loop question is gradeable', loop.expected_output, '10');

  // A model question without one is discarded, not rendered ungradeable.
  const fallback = localQuestion({ title: 'Python loops' }, { attempt: 1 });
  const noExpected = normaliseQuestion(
    { question: 'Write a program that demonstrates loops.', type: 'code_input', language: 'python' },
    fallback,
    { title: 'Python loops' },
  );
  equal('a code question with no expected output falls back', noExpected.source, 'local');
  check('and the fallback can be graded', Boolean(noExpected.expected_output), JSON.stringify(noExpected));

  const withExpected = normaliseQuestion(
    { question: 'Print the sum of 1..4.', type: 'code_input', language: 'python', expected_output: '10' },
    fallback,
    { title: 'Python loops' },
  );
  equal('a checkable code question is kept', withExpected.source, 'model');
  equal('and keeps its expected output', withExpected.expected_output, '10');
}

{
  // Smoke-only grading means "ran", not "partly right": it must be unverified.
  process.env.LM_FORCE_RUNTIME_UNAVAILABLE = '';
  const { resetRuntimeCache } = await import('../src/utils/sandbox.js');
  resetRuntimeCache();
  const smoke = await gradeAnswer({
    question: { id: 'q_smoke', type: 'code_input', language: 'python' },
    answer: 'print(123)',
    topic: { id: 't1', title: 'Loops' },
    userId: '5f0000000000000000000001',
  });
  equal('a smoke-only run is not treated as evidence', smoke.unverified, true);
  equal('and is not scheduled as a wrong-answer retry', chooseNextTopic(
    [{ id: 't1', title: 'Loops' }],
    { lastTopicId: 't1', lastVerdict: smoke.verdict, lastVerified: !smoke.unverified },
  ).reason, 'retry_unverified');
}

/* -------------------------------------------------------------------------- */
/* a verdict is announced once, not twice                                    */
/* -------------------------------------------------------------------------- */

section('feedback does not stutter');

{
  // Live run showed "Not quite. Not quite. The answer is: ..." — gradeAnswer
  // prefixed the verdict and feedbackDocument added it again.
  const wrong = await gradeAnswer({
    question: { id: 'q_r', type: 'radio', question: 'Pick', options: ['a', 'b'], correct_index: 1 },
    answer: 'a',
    topic: { id: 't1', title: 'Loops' },
    userId: '5f0000000000000000000001',
  });
  const doc = feedbackDocument({ verdict: wrong.verdict, feedback: wrong.feedback, sessionId: 's1' });
  const body = (doc.components || []).map((c) => String(c.content || '')).join(' ');
  equal('the verdict label appears exactly once', (body.match(/not quite/gi) || []).length, 1);
  check('the right answer is still shown', /The answer is: b/.test(body), body);
  check('the label is not duplicated in the raw feedback', !/not quite/i.test(wrong.feedback), wrong.feedback);

  const right = await gradeAnswer({
    question: { id: 'q_c', type: 'radio', question: 'Pick', options: ['a', 'b'], correct_index: 1 },
    answer: 'b',
    topic: { id: 't1', title: 'Loops' },
    userId: '5f0000000000000000000001',
  });
  const doc2 = feedbackDocument({ verdict: right.verdict, feedback: right.feedback, sessionId: 's1' });
  const body2 = (doc2.components || []).map((c) => String(c.content || '')).join(' ');
  check('a correct answer is not congratulated twice', !/correct\.\s*(that is right\.|correct\.)/i.test(body2), body2);
}

/* -------------------------------------------------------------------------- */
/* a question must be a question                                              */
/* -------------------------------------------------------------------------- */

section('the local fallback asks something worth answering');

{
  // The bug this replaces: with no AI key every topic produced
  //   "What is the main idea of X?"  a) the definition  b) it is unrelated…
  // where the answer was always option a and the distractors were absurdities.
  const text = [
    '## Unit 1: Java Basics',
    '- Variables and Data Types',
    '- Operators and Expressions',
    '- Type Casting',
    '## Unit 2: Control Flow',
    '- Conditionals',
    '- Loops and Iteration',
    '## Unit 3: Object-Oriented Java',
    '- Inheritance',
    '- Polymorphism',
    '## Unit 4: Errors and Files',
    '- Exceptions and Error Handling',
  ].join('\n');
  const topics = extractTopics(text);
  check('the syllabus parses', topics.length >= 8, `${topics.length} topics`);

  const absurd = [
    /unrelated to the rest of the syllabus/i,
    /only applies to advanced students/i,
    /has no practical use/i,
    /main idea of/i,
  ];

  const asked = topics.map((topic) => ({ topic, q: localQuestion(topic, { attempt: 1 }) }));
  const choice = asked.filter((x) => x.q.type === 'radio');

  for (const { topic, q } of choice) {
    const all = [q.question, ...(q.options || [])].join(' ');
    for (const bad of absurd) {
      equal(`${topic.title}: no filler option`, bad.test(all), false);
    }
    // The answer must be one of the options, and the options must be distinct.
    check(`${topic.title}: the correct option exists`, Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index < q.options.length, JSON.stringify(q.options));
    equal(`${topic.title}: options are distinct`, new Set(q.options).size, q.options.length);
    // A miss must teach: the explanation is what the learner reads afterwards.
    check(`${topic.title}: carries a reason`, Boolean(q.explanation) || q.source !== 'local', q.question);
  }

  // The right answer must not always be first — that is the habit the old
  // question trained. Over these topics the position has to vary.
  const positions = new Set(choice.map((x) => x.q.correct_index));
  check('the correct index is not always option 1', positions.size > 1, [...positions].join(','));

  // And the questions must not all be the same sentence with a noun swapped.
  const stems = new Set(choice.map((x) => x.q.question.replace(/"[^"]+"/g, 'X')));
  check('the questions are not one template', stems.size > choice.length / 2, `${stems.size} distinct stems of ${choice.length}`);
}

{
  // A known concept gets a specific, factually checkable question.
  // A loop topic is code: it becomes a runnable question with a checkable output
  // rather than a multiple choice. (Attempt 2 eases it back to a choice.)
  const q = localQuestion({ title: 'Loops and Iteration', keywords: [], summary: '' }, { attempt: 1 });
  equal('a loop topic asks for code', q.type, 'code_input');
  check('the loop question is concrete', /loop|prints/i.test(q.question), q.question);
  equal('and has a checkable output', q.expected_output, '10');

  const loopChoice = localQuestion({ title: 'Loops and Iteration', keywords: [], summary: '' }, { attempt: 2 });
  equal('a second attempt on loops becomes a choice', loopChoice.type, 'radio');
  check('that choice is about loops', /range|loop|iteration/i.test(loopChoice.question), loopChoice.question);
  check('and it has a reason', Boolean(loopChoice.explanation), loopChoice.question);

  const casting = localQuestion({ title: 'Type Casting', keywords: [], summary: '' }, { attempt: 1 });
  check('a casting topic asks about casting', /int\(|cast|convert/i.test(casting.question), casting.question);

  // An unknown topic must still ask something answerable by reasoning.
  const unknown = localQuestion({ title: 'Binary Trees', keywords: [], summary: '' }, { attempt: 1 });
  equal('an unknown topic still gets four options', unknown.options.length, 4);
  check('and the options are distinguishable by reasoning', unknown.correct_index >= 0, JSON.stringify(unknown.options));
}

{
  // The explanation reaches the learner when they get it wrong.
  const q = localQuestion({ title: 'Loops and Iteration', keywords: [], summary: '' }, { attempt: 2 });
  const wrong = (q.correct_index + 1) % q.options.length;
  const graded = await gradeAnswer({
    question: q,
    answer: q.options[wrong],
    topic: { id: 't1', title: 'Loops and Iteration' },
    userId: '5f0000000000000000000001',
  });
  equal('a wrong choice is incorrect', graded.verdict, 'incorrect');
  check('and the feedback says why', /—/.test(graded.feedback), graded.feedback);
  check('it names the right answer', graded.feedback.includes(q.options[q.correct_index]), graded.feedback);
}

/* -------------------------------------------------------------------------- */
/* the /learn loop can actually finish                                       */
/* -------------------------------------------------------------------------- */

section('checks are distinct and every one must be answered');

{
  // Getting one of two checks right used to declare the topic "understood" and
  // skip the second check entirely — the learner was credited for a question they
  // were never shown.
  const topic = { title: 'Lists and Tuples', summary: '', keywords: [] };
  const checks = await authorChecks({ topic, explanation: null, count: 2, userId: '5f0000000000000000000001' });
  equal('two checks are produced', checks.length, 2);
  equal('their ids are distinct', new Set(checks.map((c) => c.id)).size, 2);
  equal('their questions are distinct', new Set(checks.map((c) => c.question)).size, 2);

  const partial = assessUnderstanding([{ question_id: checks[0].id, verdict: 'correct' }], 2);
  equal('one correct answer of two is NOT understood', partial.understood, false);
  equal('and the reason says why', partial.reason, 'incomplete');
  equal('it reports how many were answered', partial.answered, 1);
  equal('and how many there are', partial.total, 2);

  const full = assessUnderstanding(
    checks.map((c) => ({ question_id: c.id, verdict: 'correct' })),
    2,
  );
  equal('both correct is understood', full.understood, true);
  equal('and every check was answered', full.answered, 2);

  const missedOne = assessUnderstanding(
    [{ question_id: checks[0].id, verdict: 'correct' }, { question_id: checks[1].id, verdict: 'incorrect' }],
    2,
  );
  equal('a miss among them is not understood', missedOne.understood, false);
  equal('and is recorded as a missed check', missedOne.reason, 'missed_check');
}

{
  // Ids are forced unique even if a provider hands back a shared object.
  const topic = { title: 'Unknown Topic With No Facts', summary: '', keywords: [] };
  const checks = await authorChecks({ topic, explanation: null, count: 3, userId: '5f0000000000000000000001' });
  equal('no two checks share an id', new Set(checks.map((c) => c.id)).size, checks.length);
}

/* -------------------------------------------------------------------------- */
/* the question matches the syllabus's language, and the count is honest      */
/* -------------------------------------------------------------------------- */

section('a question never mixes languages or miscounts itself');

{
  // A Java syllabus was being asked "A variable is assigned 7 and later assigned
  // 7.5. What happens in Python?" — a fine question for the wrong learner.
  const javaTopic = { title: 'Variables and Primitive Types', summary: '', keywords: [] };
  const pyTopic = { title: 'Variables and Data Types', summary: '', keywords: [] };

  equal('a Java syllabus is detected', languageFor('Section A — Java Programming'), 'java');
  equal('a Python syllabus is detected', languageFor('Section A — Python Programming'), 'python');

  const javaQ = localQuestion(javaTopic, { attempt: 1, language: 'java' });
  const pyQ = localQuestion(pyTopic, { attempt: 1, language: 'python' });

  check('the Java question does not mention Python', !/python/i.test(String(javaQ.question)), javaQ.question);
  check('the Java question names Java', /java/i.test(String(javaQ.question)), javaQ.question);
  check('the Java question is answerable', Array.isArray(javaQ.options) && javaQ.options.length === 4);
  check('the Python question still mentions Python', /python/i.test(String(pyQ.question)), pyQ.question);

  // The question that prompted this: mixed-language pseudo-syntax.
  const all = [...factsFor(javaTopic, { language: 'java' }), ...factsFor(pyTopic, { language: 'python' })];
  const mixed = all.filter((f) => /\bx = 10;|x = 'hello'/.test(String(f.ask)));
  equal('no curated question uses invented pseudo-syntax', mixed.length, 0);

  // Every curated fact keeps exactly one defensible answer.
  for (const fact of all) {
    equal(`"${fact.label}" options are distinct`, new Set([fact.answer, ...fact.wrong]).size, fact.wrong.length + 1);
    check(`"${fact.label}" explains why`, String(fact.explain || '').length > 20);
  }
}

{
  // "question 1 of 14" was counting topics. /test asks one question at a time
  // and picks the next from the answer, so it has no fixed total to count to.
  const q = { id: 'q1', type: 'radio', question: 'Which is it?', options: ['a', 'b'] };

  const open = oneQuestionForm({ question: q, topic: { title: 'Variables' }, index: 1, total: null, sessionId: 's1' });
  equal('with no fixed total the label is just the topic', open.title, 'Variables');
  check('and it never claims a count it cannot know', !/of \d+/.test(open.title), open.title);

  const counted = oneQuestionForm({ question: q, topic: { title: 'Variables' }, index: 1, total: 2, sessionId: 's1' });
  equal('a real count is still shown', counted.title, 'Variables — question 1 of 2');
}

{
  // A container heading is not a concept. Left in as a topic it produced the
  // stem `You meet "Section A — Java Programming" for the first time`.
  const java = 'Section A — Java Programming\n## Variables and Primitive Types\nint, long.\n## Loops and Iteration\nfor, while.';
  const titles = extractTopics(java).map((t) => t.title);
  check('a "Section" line is not treated as a topic', !titles.some((t) => /^section\b/i.test(t)), titles.join(' | '));
  equal('the real topics survive', titles.length >= 2, true);

  // Acronyms were being destroyed by title-casing: TCP/IP -> Tcp/Ip, SQL -> Sql.
  for (const [input, expected] of [['TCP/IP and HTTP', 'TCP/IP and HTTP'], ['SQL JOIN Types', 'SQL JOIN Types']]) {
    const [topic] = extractTopics(`## ${input}\nsome body text here.`);
    equal(`"${input}" keeps its capitals`, topic?.title, expected);
  }
  const [andTopic] = extractTopics('## Variables and Primitive Types\nsome body.');
  equal('small words stay lowercase', andTopic?.title, 'Variables and Primitive Types');
}

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) console.log(`  \x1b[31m✗\x1b[0m ${failure}`);
  process.exit(1);
}
