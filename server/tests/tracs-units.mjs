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
  localExplanation,
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
console.log('\nA round is asked once, and never in boilerplate');

{
  // Every question in a round must have its own id. Authoring runs in parallel,
  // so ids built from the clock collided: two questions from different concepts
  // shared an id, grading matched both answers to the first one found, and the
  // report listed each miss twice.
  const concept = { id: 't1', title: 'Variables store values', summary: '' };
  const other = { id: 't2', title: 'Loops repeat a block', summary: '' };
  const ids = [];
  for (const topic of [concept, other]) {
    for (let variant = 0; variant < 6; variant += 1) ids.push(localQuestion(topic, { variant }).id);
  }
  equal('twelve questions get twelve distinct ids', new Set(ids).size, ids.length);

  // And a report is one entry per miss, not one per answer.
  const questions = [
    { id: 'q1', type: 'radio', question: 'First?', options: ['A', 'B'], correct_index: 1 },
    { id: 'q2', type: 'radio', question: 'Second?', options: ['C', 'D'], correct_index: 1 },
  ];
  const results = [
    { question_id: 'q1', verdict: 'incorrect', answer: 'A' },
    { question_id: 'q2', verdict: 'incorrect', answer: 'C' },
  ];
  const report = diagnosisReport({ results, questions });
  equal('two misses are reported once each', report.misses.length, 2);
  equal('and named separately', new Set(report.misses.map((m) => m.question)).size, 2);

  // The category counts read as English.
  const mixed = diagnosisReport({
    results: [
      { question_id: 'q1', verdict: 'incorrect', answer: 'not code' },
      { question_id: 'q2', verdict: 'incorrect', answer: 'nope' },
    ],
    questions: [
      { id: 'q1', type: 'code_input', question: 'Write it', language: 'python' },
      { id: 'q2', type: 'code_input', question: 'Write it again', language: 'python' },
    ],
  });
  const heading = mixed.components.map((c) => String(c.content)).join(' ');
  // Both entries above are practical difficulties, so the plural is required —
  // asserting only "no difficultys" passed even with the naive `+'s'`.
  check('two practical difficulties are pluralised', /2 practical difficulties/.test(heading), heading.slice(0, 160));
  check('and never as "difficultys"', !/difficultys/.test(heading), heading.slice(0, 160));
}

{
  // A concept the syllabus named but did not describe still gets an explanation
  // rather than a placeholder promising one "once available".
  const explained = localExplanation({ id: 't1', title: 'Conditionals', summary: '' });
  const body = JSON.stringify(explained.components);
  check('an undescribed concept is still described', !/will appear here once/i.test(body), body.slice(0, 200));
  check('and is named in its own explanation', /Conditionals/.test(body), body.slice(0, 200));
  check('a described concept quotes the syllabus', /Quotes the rule/.test(JSON.stringify(localExplanation({ id: 't1', title: 'Conditionals', summary: 'Quotes the rule when the condition is false.' }).components)));
}

/* -------------------------------------------------------------------------- */
console.log('\nEvery round the engine asks for survives its own protocol');

{
  // The protocol caps a `question_form` at UI_LIMITS.maxQuestions, and
  // `makeDocument` drops a component that fails validation *silently*. The cap
  // was 12 while a round grows to 15, so those rounds reached the learner as a
  // one-line header with no questions under it — the whole test vanished.
  const { parseComponent } = await import('../src/modules/ai/ui/protocol.js');
  const concept = { id: 't1', title: 'Variables', summary: '' };

  for (const count of [5, 12, 13, 15]) {
    const questions = Array.from({ length: count }, (_, i) => ({
      ...localQuestion(concept, { variant: i % 7 }),
      topicId: concept.id,
    }));
    const form = testRoundForm({ questions, topic: { title: 'Python Basics' }, sessionId: 'round' });
    check(`a ${count}-question round is a valid component`, parseComponent(form).ok === true, JSON.stringify(parseComponent(form).issues || []).slice(0, 120));
  }

  // And the round size the engine actually produces never exceeds it.
  const tooMany = Array.from({ length: 16 }, (_, i) => ({ ...localQuestion(concept, { variant: i % 7 }), topicId: concept.id }));
  check('sixteen is refused', parseComponent(testRoundForm({ questions: tooMany, topic: { title: 'X' }, sessionId: 'r' })).ok === false);
}

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) console.log(`  \x1b[31m✗\x1b[0m ${failure}`);
  process.exit(1);
}
