/**
 * THE ADAPTIVE TEST AND THE TOPIC-FIRST LEARN
 * ==========================================
 *
 * Two changes from the batch round:
 *
 *   test   one question at a time, the next chosen from the answer just given,
 *          nothing revealed until the end
 *   learn  the unit's concepts, one explained at a time, each followed by
 *          exactly two choices: the next concept, or a test of this one
 *
 *   node tests/tracs-adaptive.mjs
 */

import {
  beginTest,
  firstConcept,
  nextStep,
  isComplete,
  testCeiling,
  TEST_LIMITS,
  MAX_ATTEMPTS_PER_CONCEPT,
} from '../src/modules/tracs/adaptive.js';
import {
  conceptPicker,
  explanationChoices,
  nextConceptAfter,
  conceptToLearn,
} from '../src/modules/tracs/topics-flow.js';
import { localExplanation } from '../src/modules/tracs/engine.js';
import { TUTORIALS, findTutorial } from '../src/modules/tracs/tutorials.js';
import { tutorialLesson, genericLesson } from '../src/modules/tracs/lesson-content.js';

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

const CONCEPTS = [
  { id: 'c1', title: 'Variables' },
  { id: 'c2', title: 'Loops' },
  { id: 'c3', title: 'Lists' },
  { id: 'c4', title: 'Functions' },
];
const UNIT = { index: 1, title: 'Python Basics', concepts: CONCEPTS };

/** Walk a test, answering each question from a supplied verdict. */
function walk(verdicts, concepts = CONCEPTS) {
  let plan = beginTest(concepts);
  let current = firstConcept(concepts, []);
  const asked = [];
  for (const verdict of verdicts) {
    asked.push(current);
    const step = nextStep(plan, { conceptId: current, verdict, verified: true }, concepts);
    plan = step.state;
    if (step.done) return { asked, plan, done: true, reason: step.reason };
    current = step.conceptId;
  }
  return { asked, plan, done: false };
}

/* -------------------------------------------------------------------------- */
console.log('\nA test asks one question at a time, and every concept is covered');

{
  // All correct: one question per concept, then finish.
  const { asked, done, reason } = walk(['correct', 'correct', 'correct', 'correct']);
  equal('four concepts take four questions when all are right', asked.length, 4);
  equal('and every concept was asked once', [...new Set(asked)].length, 4);
  check('and the test ends', done === true, reason);
  equal('because the unit was covered', reason, 'unit_covered');

  // The length is the unit's size, not a number picked in advance.
  const small = walk(['correct', 'correct'], [{ id: 'c1', title: 'A' }, { id: 'c2', title: 'B' }]);
  equal('a two-concept unit is two questions', small.asked.length, 2);
}

{
  // A miss earns a probe on the same concept — a different question, same idea.
  const { asked } = walk(['incorrect', 'correct', 'correct', 'correct', 'correct']);
  equal('a miss is followed by another question on the same concept', asked[1], asked[0]);
  equal('and the probe counts as the second question', asked.length, 5);
  check('the probe is not repeated forever', MAX_ATTEMPTS_PER_CONCEPT === 2, String(MAX_ATTEMPTS_PER_CONCEPT));
}

{
  // Two misses on one concept is the most it gets, then the test moves on.
  const { asked } = walk(['incorrect', 'incorrect', 'correct', 'correct', 'correct']);
  const firstThree = asked.slice(0, 3);
  equal('a concept is asked at most twice', firstThree.filter((id) => id === firstThree[0]).length, 2);
  check('and then the test moves to a different concept', firstThree[2] !== firstThree[0], JSON.stringify(firstThree));
}

{
  // A correct answer retires the concept: it is not asked again.
  const { asked } = walk(['correct', 'correct', 'correct', 'correct']);
  equal('no concept is asked twice when answered correctly', asked.length, new Set(asked).size);
}

{
  // An answer the server could not judge is not evidence, so it must not earn a
  // probe — re-asking would punish the learner for an outage.
  let plan = beginTest(CONCEPTS);
  const step = nextStep(plan, { conceptId: 'c1', verdict: 'not_graded', verified: true }, CONCEPTS);
  check('an ungraded answer does not trigger a probe', step.conceptId !== 'c1', step.reason);

  let plan2 = beginTest(CONCEPTS);
  const step2 = nextStep(plan2, { conceptId: 'c1', verdict: 'incorrect', verified: false }, CONCEPTS);
  check('an unverified answer does not trigger a probe either', step2.conceptId !== 'c1', step2.reason);
}

{
  // The next concept is adjacent, so the test walks related ideas rather than
  // jumping. Checked against a *shuffled* concept list: with the unit's own
  // order, a sort that does nothing still looks adjacent, because the fallback
  // order happens to be the syllabus order.
  const shuffled = [...CONCEPTS].reverse();
  const unit = { index: 1, title: 'Reversed', concepts: shuffled };
  const { asked } = walk(['correct', 'correct', 'correct', 'correct'], shuffled);
  const order = asked.map((id) => shuffled.findIndex((c) => c.id === id));
  const steps = order.slice(1).map((v, i) => Math.abs(v - order[i]));
  check('consecutive questions are adjacent in the syllabus', steps.every((d) => d === 1), JSON.stringify({ order, steps }));
  check('and the walk covers the unit in order', order.every((v, i) => i === 0 || v === order[i - 1] + 1), JSON.stringify(order));
  void unit;
}

{
  equal('the ceiling for four concepts', testCeiling(CONCEPTS), 8);
  equal('a small unit still gets a floor', testCeiling([{ id: 'a' }]), TEST_LIMITS.min);
  check('and no unit exceeds the cap', testCeiling(Array.from({ length: 40 }, (_, i) => ({ id: `c${i}` }))) === TEST_LIMITS.max);
}

{
  // The first concept is the one whose state is most in doubt.
  const weak = firstConcept(CONCEPTS, [{ id: 'c2', title: 'Loops', correct: 0, mastery: 0 }, { id: 'c3', title: 'Lists', correct: 3, mastery: 3 }]);
  check('the first question goes to a concept not yet demonstrated', weak !== 'c3', weak);
  equal('with no history, the first concept in the syllabus', firstConcept(CONCEPTS, []), 'c1');
}

/* -------------------------------------------------------------------------- */
console.log('\nLearn explains one concept and offers exactly two ways on');

{
  const picker = conceptPicker({ unit: UNIT, topics: [], currentId: 'c2' });
  equal('every concept in the unit is offered', picker.actions.length, 4);
  check('each action carries its concept', picker.actions.every((a) => a.topic_id), JSON.stringify(picker.actions.map((a) => a.topic_id)));
  check('and names the command it runs', picker.actions.every((a) => a.action === 'continue_lesson' && a.command === 'learn'));
  check('the current concept is marked', picker.actions.find((a) => a.topic_id === 'c2').label.startsWith('▸'), picker.actions.map((a) => a.label).join(' | '));
}

{
  const choices = explanationChoices({ unit: UNIT, concept: CONCEPTS[0], nextConcept: CONCEPTS[1], topics: [] });
  equal('an explanation offers exactly two things', choices.actions.length, 2);
  equal('one of them tests this topic', [choices.actions[0].command, choices.actions[0].topic_id], ['test', 'c1']);
  equal('the other moves to the next topic', [choices.actions[1].command, choices.actions[1].topic_id], ['learn', 'c2']);
  check('and both name the concept they act on', /Variables/.test(choices.actions[0].label) && /Loops/.test(choices.actions[1].label), JSON.stringify(choices.actions.map((a) => a.label)));
}

{
  const last = explanationChoices({ unit: UNIT, concept: CONCEPTS[3], nextConcept: null, topics: [] });
  equal('the last concept still offers its test', last.actions.length, 1);
  equal('and that test targets it', last.actions[0].topic_id, 'c4');
}

{
  equal('the next concept is the following one', nextConceptAfter(UNIT, 'c1', []).id, 'c2');
  // A concept already demonstrated is skipped in favour of an unattempted one.
  const skipped = nextConceptAfter(UNIT, 'c1', [{ id: 'c2', mastery: 3 }, { id: 'c3', mastery: 0 }]);
  equal('a demonstrated concept is skipped', skipped.id, 'c3');
  equal('the last concept has no next', nextConceptAfter(UNIT, 'c4', []), null);
}

{
  // Learn with nothing chosen opens where the learner actually is.
  equal('an explicit choice wins', conceptToLearn({ unit: UNIT, topics: [], topicId: 'c3' }).id, 'c3');
  equal('otherwise the first undemonstrated concept', conceptToLearn({ unit: UNIT, topics: [{ id: 'c1', mastery: 2 }], topicId: null }).id, 'c2');
  equal('with everything demonstrated, the first concept', conceptToLearn({ unit: UNIT, topics: CONCEPTS.map((c) => ({ id: c.id, mastery: 3 })), topicId: null }).id, 'c1');
  equal('a unit with no concepts explains nothing', conceptToLearn({ unit: { concepts: [] }, topics: [] }), null);
}

{
  // A stale or invented topic id must not crash the turn.
  equal('an unknown topic falls back rather than throwing', conceptToLearn({ unit: UNIT, topics: [], topicId: 'nope' }).id, 'c1');
}

/* -------------------------------------------------------------------------- */
/* the explanation has to actually teach                                      */
/* -------------------------------------------------------------------------- */
//
// This suite used to check the *flow* of /learn and nothing about its content,
// and the content had quietly collapsed to a single sentence reconstructed from
// the topic's name. A learner reported exactly that: the lesson told them the
// topic was "one of the topics in your syllabus" and stopped. These checks fail
// if a lesson ever gets that thin again.

const countSections = (components) =>
  (components || []).reduce((total, c) => total + (c.sections || []).length, 0);
const lessonText = (components) => JSON.stringify(components ?? null);
// A fence around nothing is not a code example, so empty blocks do not count.
const codeBlocks = (components) => {
  const blocks = lessonText(components).match(/```[a-z]*\\n([\s\S]*?)```/g) || [];
  return blocks.filter((block) => block.replace(/```[a-z]*|```/g, '').trim().length > 0).length;
};

{
  // The complaint, as a test: "Conditional Statements" gets a real tutorial.
  const components = tutorialLesson({ title: 'Conditional Statements' });
  check('a curated concept produces components', Array.isArray(components) && components.length > 0);
  check('the lesson has many sections, not one', countSections(components) >= 8, `${countSections(components)} sections`);
  check('the lesson carries real code examples', codeBlocks(components) >= 3, `${codeBlocks(components)} blocks`);
  check('worked examples show what the code prints', lessonText(components).includes('**Output**'));
  check('it says what the concept is', lessonText(components).includes('What it is'));
  check('it says why the concept exists', lessonText(components).includes('Why it exists'));
  check('it shows the syntax', lessonText(components).includes('The syntax'));
  check('it names the mistakes people make', lessonText(components).includes('Where it goes wrong'));
  check('it tells the learner how to check themselves', lessonText(components).includes('Check yourself'));
  check('no section is the old apology sentence', !lessonText(components).includes('does not spell it out'));
  check('the lesson is substantial, not a paragraph', lessonText(components).length > 3000, `${lessonText(components).length} chars`);
}

{
  // Every curated tutorial must be usable, not just the one that was reported.
  for (const tutorial of TUTORIALS) {
    check(`${tutorial.label}: has an explanation`, Boolean(tutorial.what && tutorial.why));
    check(`${tutorial.label}: has at least two worked examples`, (tutorial.examples || []).length >= 2);
    check(`${tutorial.label}: has at least one trap`, (tutorial.traps || []).length >= 1);
    check(`${tutorial.label}: has a self-check`, Boolean(tutorial.check));
  }

  // A tutorial whose "why" is empty teaches a name and nothing else.
  const hollow = TUTORIALS.filter((t) => !t.what || !t.why || !t.syntax || !t.check);
  check('no tutorial is a stub', hollow.length === 0, hollow.map((t) => t.label).join(', '));

  // An example with an empty code block is a claim with no evidence.
  const emptyCode = TUTORIALS.flatMap((t) =>
    [...t.examples, ...t.traps]
      .filter((e) => !String(e.code || '').trim())
      .map((e) => `${t.label}: ${e.title}`));
  check('every example carries real code', emptyCode.length === 0, emptyCode.join(', '));

  // Where a program is shown, saying what it prints is what makes it verifiable.
  const noOutput = TUTORIALS.flatMap((t) =>
    t.examples.filter((e) => !String(e.output || '').trim() && !/Error|TypeError/.test(e.why))
      .map((e) => `${t.label}: ${e.title}`));
  check('every runnable example says what it prints', noOutput.length === 0, noOutput.join(', '));
}

{
  // A syllabus names topics in its own words; matching on wording alone would
  // miss them. These are the phrasings a real syllabus uses.
  const phrasings = {
    'Conditional Statements': 'Conditionals',
    'If-Else Statements': 'Conditionals',
    Conditionals: 'Conditionals',
    Loops: 'Loops',
    'Loops and Iteration': 'Loops',
    'For and While Loops': 'Loops',
    'Variables and Data Types': 'Variables and data types',
    Functions: 'Functions',
    'Defining Functions': 'Functions',
    'Classes and Objects': 'Classes and objects',
    Inheritance: 'Inheritance',
    Polymorphism: 'Inheritance',
    'Lists and Dictionaries': 'Lists and arrays',
    Arrays: 'Lists and arrays',
    'Error Handling': 'Errors and exceptions',
    'File Handling': 'Input and output',
    'Recursion and Backtracking': 'Recursion',
    'Searching and Sorting': 'Searching and sorting',
    'Stacks and Queues': 'Stacks and queues',
    'Queues': 'Stacks and queues',
    'Linked Lists': 'Lists and arrays',
  };
  for (const [title, expected] of Object.entries(phrasings)) {
    const found = findTutorial(title);
    equal(`"${title}" is recognised`, found?.label ?? null, expected);
  }

  // A broad container name ("Data Structures") is not one concept, so it is
  // allowed to fall back — but the fallback still has to be a lesson.
  const broad = findTutorial('Data Structures');
  check('a broad container name falls back rather than mismatching', broad === null);
  check('the fallback for a broad name still teaches',
    countSections(genericLesson({ title: 'Data Structures', keywords: ['stack', 'queue'] })) >= 4);
}

{
  // A concept with no curated tutorial still has to be a lesson, not a sentence.
  const components = genericLesson({ title: 'Recursion and Backtracking', keywords: ['base case', 'recursive call'] });
  check('an unknown concept still gets sections', countSections(components) >= 4, `${countSections(components)} sections`);
  check('an unknown concept still gets a worked case', codeBlocks(components) >= 1);
  check('an unknown concept is never the apology sentence', !lessonText(components).includes('does not spell it out'));

  // And with nothing to go on at all, it must not crash or return nothing.
  const bare = genericLesson({ title: 'Something New', keywords: [] });
  check('a bare concept still produces sections', countSections(bare) >= 3, `${countSections(bare)} sections`);
}

{
  // End to end through the function the routes actually call.
  const doc = localExplanation({ title: 'Conditional Statements' });
  const components = doc.components || [];
  check('localExplanation returns a document', components.length > 0);
  check('localExplanation teaches, it does not summarise', countSections(components) >= 8, `${countSections(components)} sections`);
  check('localExplanation includes code', codeBlocks(components) >= 3, `${codeBlocks(components)} blocks`);

  // A concept with no tutorial goes through the generic path, never the one-liner.
  const unknown = localExplanation({ title: 'Quantum Tracing' });
  check('an unknown concept is still multiple sections', countSections(unknown.components) >= 4);
  check('an unknown concept is never a single sentence',
    lessonText(unknown.components).length > 800, `${lessonText(unknown.components).length} chars`);
}

{
  // The syllabus's own words are kept, but attributed — not passed off as the
  // whole explanation, which is what made the lesson look empty.
  const doc = localExplanation({ title: 'Conditional Statements', summary: 'Covers if, elif and else.' });
  const syllabus = (doc.components || []).find((c) => c.id === 'learn_local_syllabus');
  check('the syllabus note survives', Boolean(syllabus));
  check('the syllabus note is not the whole lesson', (doc.components || []).length > 1);
}

{
  // Re-teaching after a miss must add something, not repeat the lesson verbatim.
  const plain = localExplanation({ title: 'Loops' });
  const reTeach = localExplanation({ title: 'Loops' }, { reTeach: true });
  check('re-teaching adds a section', (reTeach.components || []).length > (plain.components || []).length);
}

{
  // Every concept in a unit must be reachable and teachable — this is the sweep
  // a learner's syllabus actually walks, driven through the real entry points
  // rather than a hand-picked title.
  const syllabus = [
    'Variables and Data Types', 'Operators and Expressions', 'Conditional Statements',
    'Loops and Iteration', 'Functions', 'Lists and Tuples', 'Dictionaries and Sets',
    'Strings', 'Classes and Objects', 'Inheritance', 'Error Handling', 'File Handling',
    'Recursion and Backtracking', 'Searching and Sorting', 'Stacks and Queues',
  ];
  const thin = [];
  for (const title of syllabus) {
    const doc = localExplanation({ title });
    const sections = countSections(doc.components);
    if (sections < 6 || codeBlocks(doc.components) < 3) {
      thin.push(`${title}: ${sections} sections / ${codeBlocks(doc.components)} blocks`);
    }
  }
  check('a full syllabus never produces a thin lesson', thin.length === 0, thin.join('; '));
}

{
  // A lesson is read in a chat pane, so it must not be a wall of unbroken prose:
  // the renderer needs headings and fenced code to break it up.
  const doc = localExplanation({ title: 'Conditional Statements' });
  const taught = doc.components.filter((c) => c.type === 'learning');
  check('the lesson is split across several blocks', taught.length >= 3, `${taught.length} blocks`);
  const headings = taught.flatMap((c) => (c.sections || []).map((s) => s.heading));
  check('no two sections share a heading', new Set(headings).size === headings.length);
  const longest = Math.max(...taught.flatMap((c) => (c.sections || []).map((s) => s.body.length)));
  check('no single section is an unreadable wall', longest < 3000, `${longest} chars`);
}

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) console.log(`  \x1b[31m✗\x1b[0m ${failure}`);
  process.exit(1);
}
