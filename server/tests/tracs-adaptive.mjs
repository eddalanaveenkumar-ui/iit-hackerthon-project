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

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) console.log(`  \x1b[31m✗\x1b[0m ${failure}`);
  process.exit(1);
}
