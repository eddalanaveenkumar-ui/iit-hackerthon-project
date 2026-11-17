/**
 * TRACS — UNITS, ROUNDS AND DIAGNOSIS
 * ===================================
 *
 * The flow the brief describes:
 *
 *   upload  →  the syllabus, as units of concepts, before any chat
 *   choose  →  a unit, then Learn or Test
 *   learn   →  explain the unit's concepts, then test
 *   test    →  no explanation; straight to questions
 *   round   →  5–15 questions over the unit, submitted together
 *   report  →  every miss named as a knowledge gap, misconception or practical
 *              difficulty, and explained
 *   retest  →  NEW questions on the same concepts, until a round is all correct
 *
 * Everything here is deterministic: no provider key is configured, so these are
 * the paths that must work when the model is unavailable.
 *
 *   node tests/tracs-units.mjs
 */

import {
  extractTopics,
  groupTopicsByUnit,
  syllabusMarkdown,
  questionsPerRound,
} from '../src/modules/tracs/topics.js';
import {
  diagnoseMistake,
  diagnosisReport,
  localQuestion,
  authorRound,
  testRoundForm,
  DIAGNOSIS_LABELS,
} from '../src/modules/tracs/engine.js';

let passed = 0;
const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
function equal(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const SYLLABUS = `### Unit 1: Java Fundamentals
- Variables and Primitive Types
- Operators and Expressions
- Conditionals
### Unit 2: Object Orientation
- Classes and Objects
- Inheritance`;

/* -------------------------------------------------------------------------- */
console.log('\nThe syllabus is shown as units of concepts');

{
  const topics = extractTopics(SYLLABUS);
  const units = groupTopicsByUnit(topics);

  equal('two units are found', units.length, 2);
  equal('the first unit carries its concepts', units[0].concepts.map((c) => c.title), ['Variables and Primitive Types', 'Operators and Expressions', 'Conditionals']);
  equal('the second unit carries its concepts', units[1].concepts.map((c) => c.title), ['Classes and Objects', 'Inheritance']);

  // The exact shape the brief asked for.
  const markdown = syllabusMarkdown(units);
  check('renders as "### Unit 1:" with bulleted concepts', /^### Unit 1: Java Fundamentals\n\n- Variables and Primitive Types\n- Operators and Expressions\n- Conditionals/m.test(markdown), markdown.slice(0, 120));
  check('and the second unit follows', /### Unit 2: Object Orientation\n\n- Classes and Objects\n- Inheritance/m.test(markdown), markdown);

  // A unit heading is a container, not a concept. Checked against the unit names
  // themselves — the old assertion looked for a "Unit N" prefix, which
  // cleanHeading had already stripped, so it passed even when the heading came
  // back as a concept.
  const unitNames = units.map((u) => u.title.toLowerCase());
  const conceptTitles = topics.map((t) => t.title.toLowerCase());
  check('the unit name is not also a concept', !conceptTitles.some((t) => unitNames.includes(t)), JSON.stringify(conceptTitles));
  check('no concept swallows the whole document', !topics.some((t) => t.title.length > 60), JSON.stringify(topics.map((t) => t.title)));

  // A syllabus with no structure at all still produces something usable.
  const flat = groupTopicsByUnit(extractTopics('Loops repeat a block. Functions return a value.'));
  check('an unstructured syllabus still groups', flat.length >= 1 && flat[0].concepts.length >= 1, JSON.stringify(flat.map((u) => u.concepts.length)));
}

/* -------------------------------------------------------------------------- */
console.log('\nHow many questions a round asks');

{
  equal('one concept is a short round', questionsPerRound({ concepts: 1 }), 5);
  equal('three concepts fit the middle', questionsPerRound({ concepts: 3 }), 9);
  equal('many concepts cap at fifteen', questionsPerRound({ concepts: 9 }), 15);
  check(
    'a later round asks more than the first',
    questionsPerRound({ concepts: 3, round: 3 }) > questionsPerRound({ concepts: 3, round: 1 }),
    `round 1: ${questionsPerRound({ concepts: 3, round: 1 })}, round 3: ${questionsPerRound({ concepts: 3, round: 3 })}`,
  );
  for (const n of [1, 2, 5, 9, 20]) {
    const count = questionsPerRound({ concepts: n, round: 1 });
    check(`the count stays inside 5–15 for ${n} concepts`, count >= 5 && count <= 15, String(count));
  }
}

/* -------------------------------------------------------------------------- */
console.log('\nA wrong answer is named as one of the three categories');

{
  const radio = { id: 'q1', type: 'radio', question: 'Which is it?', options: ['Alpha', 'Beta', 'Gamma', 'Delta'], correct_index: 1 };

  const wrongChoice = diagnoseMistake({ question: radio, verdict: 'incorrect', chosen: 'Gamma' });
  equal('choosing a wrong option is a misconception', wrongChoice.category, 'misconception');
  check('and the detail quotes both what was chosen and what is right', /Gamma/.test(wrongChoice.detail) && /Beta/.test(wrongChoice.detail), wrongChoice.detail);

  const code = diagnoseMistake({ question: { type: 'code_input' }, verdict: 'incorrect', chosen: 'x = 1' });
  equal('a failed program is a practical difficulty', code.category, 'practical_difficulty');

  const blank = diagnoseMistake({ question: radio, verdict: 'unanswered', chosen: '' });
  equal('a blank answer is not a misconception', blank.category, null);
  check('and is not filed as a gap either', /not counted/i.test(blank.detail), blank.detail);

  const ungraded = diagnoseMistake({ question: radio, verdict: 'not_graded', chosen: 'Alpha', runtimeUnavailable: true });
  check('an answer that could not be judged is not diagnosed as a mistake', ungraded === null || ungraded.category === null, JSON.stringify(ungraded));

  equal('a correct answer has no diagnosis', diagnoseMistake({ question: radio, verdict: 'correct' }), null);

  const shortAnswer = diagnoseMistake({
    question: { type: 'text_input', question: 'Name the type of 3.0' },
    verdict: 'incorrect',
    chosen: 'it is a float value',
    graded: { correct_answer: 'float' },
  });
  equal('a near miss on a short answer is a practical difficulty', shortAnswer.category, 'practical_difficulty');

  check('all three category labels exist', Object.values(DIAGNOSIS_LABELS).length === 3, JSON.stringify(DIAGNOSIS_LABELS));
}

/* -------------------------------------------------------------------------- */
console.log('\nThe end-of-round report');

{
  const questions = [
    { id: 'q1', type: 'radio', question: 'Which is it?', options: ['Alpha', 'Beta'], correct_index: 1 },
    { id: 'q2', type: 'radio', question: 'And this one?', options: ['One', 'Two'], correct_index: 0 },
  ];
  const results = [
    { question_id: 'q1', verdict: 'incorrect', answer: 'Alpha', feedback: 'Beta is right because the rule says so.' },
    { question_id: 'q2', verdict: 'correct', answer: 'One' },
  ];
  const report = diagnosisReport({ results, questions });

  equal('only the miss is reported', report.misses.length, 1);
  equal('it carries its category', report.misses[0].category, 'misconception');
  check('the report explains it in the learner view', /What went wrong|misconception/i.test(report.components.map((c) => c.content).join(' ')), 'no explanation component');

  const clean = diagnosisReport({ results: [{ question_id: 'q2', verdict: 'correct' }], questions });
  equal('a clean round produces no report', clean.components.length, 0);
}

/* -------------------------------------------------------------------------- */
console.log('\nA round is 5–15 questions, all distinct');

{
  const concepts = groupTopicsByUnit(extractTopics(SYLLABUS))[0].concepts
    .map((c) => ({ ...c, summary: '' }));

  for (const count of [5, 9, 12]) {
    const questions = await authorRound({ concepts, count, sessionText: 'Java' });
    equal(`a ${count}-question round has ${count} questions`, questions.length, count);
    const stems = questions.map((q) => String(q.question).toLowerCase());
    equal(`and all ${count} are distinct`, new Set(stems).size, count);
    check('every question names the concept it belongs to', questions.every((q) => q.topicId), 'missing topicId');
  }
}

/* -------------------------------------------------------------------------- */
console.log('\nA retest asks new questions');

{
  const concept = { id: 't1', title: 'Conditionals', summary: 'if, else and switch decide which block runs.' };
  const first = await authorRound({ concepts: [concept], count: 5, sessionText: 'Java' });
  const topicsForm = testRoundForm({ questions: first, topic: concept, sessionId: 's1' });

  equal('the form carries every question', topicsForm.questions.length, 5);
  equal('each question is required', topicsForm.questions.every((q) => q.required === true), true);
  check('the button counts the answers', /5 answers/.test(topicsForm.submission.button_text), topicsForm.submission.button_text);

  const second = await authorRound({ concepts: [concept], count: 5, sessionText: 'Java', avoid: first.map((q) => q.question) });
  const overlap = second.filter((q) => first.some((f) => f.question === q.question)).length;
  equal('the retest does not repeat the first round', overlap, 0);
}

/* -------------------------------------------------------------------------- */
console.log('\nThe local fallback can fill a round on its own');

{
  // With no model configured this is the only source of questions, so it has to
  // produce enough distinct ones for a five-question round on a single concept.
  const concept = { id: 't1', title: 'Variables and Primitive Types', summary: '' };
  const seen = new Set();
  for (let variant = 0; variant <= 6; variant += 1) {
    const question = localQuestion(concept, { variant });
    if (question?.question) seen.add(question.question);
  }
  check('seven variants of one concept are distinct', seen.size >= 5, `${seen.size} distinct`);
  check('and they all ask something', [...seen].every((q) => q.includes('?') || q.includes('.')), JSON.stringify([...seen].slice(0, 2)));
}

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) console.log(`  \x1b[31m✗\x1b[0m ${failure}`);
  process.exit(1);
}
