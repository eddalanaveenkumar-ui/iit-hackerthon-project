/**
 * LOCAL TEMPLATE REGRESSION TEST
 * ==============================
 *
 * The deterministic author (used when no model key is configured) builds its
 * documents from hand-written templates and validates them on the way out. When
 * a template emits a field the schema does not know, `buildLocalTutorial` does
 * not throw — it silently falls back to a prose-only document. That is the right
 * runtime behaviour and a terrible failure mode: a whole lesson degrades to one
 * paragraph and nothing reports it.
 *
 * This test builds every template and asserts that each one produced a real
 * lesson rather than the fallback.
 *
 *   node tests/local-templates.mjs
 */

import { buildLocalTutorial } from '../src/modules/ai/ui/teaching-engine.js';

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
    failures.push(`[${group}] ${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Questions that must select a specific template. */
const CASES = [
  ['recursion', 'recursion base case call stack', 'recursion'],
  ['python loops', 'python for loop range', 'loops'],
  ['derivatives', 'derivative calculus limit', 'maths'],
  ["newton's laws", 'newton force acceleration physics', 'physics'],
  ['gradient descent', 'gradient descent machine learning neural', 'ml'],
  ['sorting', 'sorting algorithm complexity big o', 'algorithms'],
  ['sql', 'sql select join query', 'sql'],
  ['something generic', 'explain photosynthesis', 'generic'],
];

section('1. Every template produces a lesson, not the prose fallback');

for (const [label, question] of CASES) {
  const result = buildLocalTutorial({ question, level: 'beginner' });
  check(`${label}: not the fallback document`, result.source !== 'local-fallback', result.source);
  check(`${label}: has several component types`, result.document.components.length >= 4, `${result.document.components.length} components`);
  if (result.issues?.length) {
    check(`${label}: no schema issues`, false, JSON.stringify(result.issues[0]));
  }
}

section('2. Coding questions are executable and checkable');

for (const [label, question] of CASES) {
  const result = buildLocalTutorial({ question, level: 'beginner' });
  const forms = result.document.components.filter((c) => c.type === 'question_form');
  const codeQuestions = forms.flatMap((f) => f.questions.filter((q) => q.type === 'code_input'));
  for (const q of codeQuestions) {
    check(
      `${label}: code question declares expected_output`,
      typeof q.expected_output === 'string' && q.expected_output.length > 0,
      JSON.stringify(q.question || '').slice(0, 60),
    );
    check(`${label}: code question names a runnable language`, ['python', 'javascript'].includes(q.language), q.language);
  }
}

section('3. A rejected component never silently disappears');

for (const [, question] of CASES) {
  const result = buildLocalTutorial({ question, level: 'beginner' });
  check(`${question.slice(0, 28)}: the document parses cleanly`, !result.issues?.length, JSON.stringify(result.issues?.[0]));
}

console.log(`\n${failures.length ? '\x1b[31m' : '\x1b[32m'}${passed} passed, ${failures.length} failed\x1b[0m\n`);
if (failures.length) {
  for (const failure of failures) console.log(`  • ${failure}`);
  process.exit(1);
}
