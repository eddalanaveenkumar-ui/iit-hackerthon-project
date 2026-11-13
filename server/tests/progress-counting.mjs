/**
 * PROGRESS COUNTING
 * =================
 *
 * A lesson's completion percentage must reflect *sections completed*, not the
 * number of bookkeeping rows. A quiz submission records a `quizzes` entry and
 * adds the component id to `completedComponentIds`; the progress deriver used to
 * count both, so one quiz counted as two sections and a nine-section lesson read
 * 44% after a form and a quiz instead of 22%.
 *
 * This exercises the pure serialiser directly — no database, no server.
 *
 *   node tests/progress-counting.mjs
 */

import { serialiseProgress } from '../src/modules/learning/progress.js';

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

const doc = (overrides = {}) => ({
  lessonId: 'ui_test',
  totalComponents: 9,
  completedComponentIds: [],
  quizzes: [],
  forms: [],
  ...overrides,
});

section('1. A fresh lesson is 0%, not 100%');

{
  const progress = serialiseProgress(doc());
  check('completed count is zero', progress.completedCount === 0, String(progress.completedCount));
  check('percent is zero', progress.percent === 0, String(progress.percent));
  check('status is not_started', progress.status === 'not_started', progress.status);
}

section('2. One completed section counts once');

{
  const progress = serialiseProgress(doc({ completedComponentIds: ['quiz'] }));
  check('a single id is 1 section', progress.completedCount === 1, String(progress.completedCount));
  check('of nine sections that is 11%', progress.percent === 11, String(progress.percent));
}

{
  // The exact bug: the same component named by both signals.
  const progress = serialiseProgress(doc({
    completedComponentIds: ['quiz'],
    quizzes: [{ componentId: 'quiz', score: 100 }],
  }));
  check('a quiz recorded twice is still one section', progress.completedCount === 1, String(progress.completedCount));
  check('percent is not inflated', progress.percent === 11, String(progress.percent));
}

{
  const progress = serialiseProgress(doc({
    completedComponentIds: ['check', 'quiz'],
    quizzes: [{ componentId: 'quiz', score: 100 }],
    forms: [{ componentId: 'check', score: 80 }],
  }));
  check('a form plus a quiz is two sections', progress.completedCount === 2, String(progress.completedCount));
  check('two of nine is 22%', progress.percent === 22, String(progress.percent));
  check('status is in_progress', progress.status === 'in_progress', progress.status);
}

section('3. Signals without a completedComponentIds entry still count');

{
  // gradeQuiz writes both, but a document written by an older version may not.
  const progress = serialiseProgress(doc({ quizzes: [{ componentId: 'quiz' }] }));
  check('a quiz row alone marks the section', progress.completedCount === 1, String(progress.completedCount));

  const onlyForm = serialiseProgress(doc({ forms: [{ componentId: 'check' }] }));
  check('a form row alone marks the section', onlyForm.completedCount === 1, String(onlyForm.completedCount));
}

section('4. Completion and ceilings');

{
  const all = Array.from({ length: 9 }, (_, i) => `c${i}`);
  const progress = serialiseProgress(doc({ completedComponentIds: all }));
  check('every section complete reads 100%', progress.percent === 100, String(progress.percent));
  check('status is completed', progress.status === 'completed', progress.status);
}

{
  // A document whose total is understated must not read over 100%.
  const progress = serialiseProgress(doc({ totalComponents: 2, completedComponentIds: ['a', 'b', 'c', 'd'] }));
  check('percent never exceeds 100', progress.percent <= 100, String(progress.percent));
  check('total is raised to the completed count', progress.totalComponents >= 4, String(progress.totalComponents));
}

console.log(`\n${failures.length ? '\x1b[31m' : '\x1b[32m'}${passed} passed, ${failures.length} failed\x1b[0m\n`);
if (failures.length) {
  for (const failure of failures) console.log(`  • ${failure}`);
  process.exit(1);
}
