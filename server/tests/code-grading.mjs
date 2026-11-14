/**
 * CODE GRADING — sandbox-verified answers
 * =======================================
 *
 * Spec 2 requires coding answers to be verified by real execution, not by a
 * model's opinion. These tests run the grader against the actual sandbox, so
 * they are slower than the rest of the suite (a timeout case alone takes five
 * seconds) but they prove the behaviour rather than mocking it.
 *
 *   node tests/code-grading.mjs
 */

import { gradeCodeAnswer, gradeCodingAnswers, applyExecutionVerdicts, resolveLanguage } from '../src/modules/learning/code-grading.js';

let passed = 0;
const failures = [];
let group = '';

function section(name) {
  group = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures.push(`[${group}] ${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const q = (extra = {}) => ({ id: 'q1', type: 'code_input', question: 'Write it', language: 'python', ...extra });

/* -------------------------------------------------------------------------- */
/* correctness is decided by running the code                                  */
/* -------------------------------------------------------------------------- */

section('1. The sandbox decides, not the model');

{
  const ok = await gradeCodeAnswer({ question: q({ expected_output: '6' }), code: 'print(3 * 2 * 1)' });
  check('code producing the expected output is correct', ok.verdict === 'correct', ok.verdict);
  check('the result records that it was executed', ok.executed === true);
  check('the actual output is reported back', ok.output.includes('6'), JSON.stringify(ok.output));

  const wrong = await gradeCodeAnswer({ question: q({ expected_output: '6' }), code: 'print(0)' });
  check('wrong output is incorrect', wrong.verdict === 'incorrect', wrong.verdict);
  check('the mismatch explains what was expected and what ran', /Expected .6.*got .0/s.test(wrong.feedback), wrong.feedback.slice(0, 120));

  const crash = await gradeCodeAnswer({ question: q({ expected_output: '6' }), code: 'print(1 / 0)' });
  check('code that raises is incorrect', crash.verdict === 'incorrect', crash.verdict);
  check('the runtime error is surfaced', /ZeroDivisionError|division by zero/i.test(crash.error || crash.feedback));
}

/* -------------------------------------------------------------------------- */
/* it never claims more than it proved                                        */
/* -------------------------------------------------------------------------- */

section('2. No false passes');

{
  // No declared expectation: the answer runs, but correctness was not checked.
  const smoke = await gradeCodeAnswer({ question: q(), code: 'x = 1' });
  check('code without an expectation is never "correct"', smoke.verdict === 'partly_correct', smoke.verdict);
  check('the feedback says correctness was not checked', /not checked against an expected result/i.test(smoke.feedback));

  const timedOut = await gradeCodeAnswer({ question: q(), code: 'while True:\n    pass' });
  check('a timeout is incorrect, not a silent pass', timedOut.verdict === 'incorrect', timedOut.verdict);
  check('the timeout is explained', /did not finish|5 second/i.test(timedOut.feedback));

  const java = await gradeCodeAnswer({ question: { id: 'q1', type: 'code_input', language: 'java' }, code: 'class A {}' });
  check('a non-runnable language is never a pass', java.verdict === 'partly_correct', java.verdict);
  check('static-only grading says so', /cannot execute java|statically/i.test(java.feedback));
  check('a java answer is not silently treated as python', resolveLanguage({ language: 'java' }) === 'java');

  const empty = await gradeCodeAnswer({ question: q(), code: '   ' });
  check('an empty answer is incorrect', empty.verdict === 'incorrect', empty.verdict);
}

/* -------------------------------------------------------------------------- */
/* the model cannot overrule the sandbox                                      */
/* -------------------------------------------------------------------------- */

section('3. Execution verdicts are authoritative');

{
  const modelSaysCorrect = {
    score: 100,
    per_question: [{ question_id: 'q1', verdict: 'correct', feedback: 'Looks great!' }],
  };
  const executionFailed = [{
    question_id: 'q1',
    executed: true,
    verdict: 'incorrect',
    language: 'python',
    feedback: 'Raised ZeroDivisionError',
  }];

  const merged = applyExecutionVerdicts(modelSaysCorrect, executionFailed);
  const entry = merged.per_question.find((p) => p.question_id === 'q1');
  check('a failing test overrides a model verdict of "correct"', entry.verdict === 'incorrect', entry.verdict);
  check('the execution feedback replaces the model feedback', /ZeroDivisionError/.test(entry.feedback));
  check('the verdict is marked as verified-by-execution', entry.executed === true && entry.verified === false);
  check('the score is recomputed from execution', merged.score === 0, String(merged.score));
  check('the next step points at the failing code', /fix the failing code/i.test(merged.next_step || ''));
}

{
  // A coding question the model omitted still receives its verdict.
  const merged = applyExecutionVerdicts({ score: 50, per_question: [] }, [
    { question_id: 'q9', executed: true, verdict: 'correct', language: 'python', feedback: 'Passed.' },
  ]);
  const entry = merged.per_question.find((p) => p.question_id === 'q9');
  check('an unmentioned coding answer is still graded', entry?.verdict === 'correct');
}

/* -------------------------------------------------------------------------- */
/* multiple answers, mixed languages                                          */
/* -------------------------------------------------------------------------- */

section('4. A whole submission');

{
  const questions = [
    q({ id: 'c1', expected_output: '6' }),
    q({ id: 'c2', language: 'javascript', expected_output: '6' }),
    { id: 't1', type: 'textarea', question: 'Explain it' },
  ];
  const answers = [
    { question_id: 'c1', value: 'print(6)' },
    { question_id: 'c2', value: 'console.log(3 * 2)' },
    { question_id: 't1', value: 'It multiplies.' },
  ];
  const results = await gradeCodingAnswers({ questions, answers });
  check('every coding answer is graded', results.length === 2, String(results.length));
  check('python is executed', results.find((r) => r.question_id === 'c1')?.verdict === 'correct');
  check('javascript is executed', results.find((r) => r.question_id === 'c2')?.verdict === 'correct');
  check('free text is not executed', !results.some((r) => r.question_id === 't1'));
}

/* -------------------------------------------------------------------------- */
/* a missing runtime is not a wrong answer                                    */
/* -------------------------------------------------------------------------- */

section('A missing interpreter is an environment fault, never a verdict');

{
  // Reproduce the production failure: a Node-only image has no `python3`, so
  // `spawn` raises ENOENT before any of the student's code runs. That must not
  // be reported as "incorrect" — the student's program may be perfectly right.
  process.env.LM_FORCE_RUNTIME_UNAVAILABLE = 'python';
  const { resetRuntimeCache, executeCode } = await import('../src/utils/sandbox.js');
  resetRuntimeCache();

  const outcome = await executeCode({ code: 'print(2 + 2)', language: 'python', mode: 'run' });
  check('the sandbox reports it did not run', outcome.executed === false);
  check('and flags the missing runtime', outcome.runtimeUnavailable === true, JSON.stringify(outcome.runtime));
  check('the reason names the cause', /no Python interpreter/i.test(outcome.reason || ''), outcome.reason);
  check('it is not reported as a code error', !outcome.loadError);

  // The wording the learner sees must not blame them.
  const graded = await gradeCodeAnswer({ question: q({ expected_output: '4' }), code: 'print(2 + 2)' });
  check('the verdict is not "incorrect"', graded.verdict !== 'incorrect', graded.verdict);
  check('it is "partly_correct" (recorded, not verified)', graded.verdict === 'partly_correct', graded.verdict);
  check('the feedback explains why it was not verified', /not verified|no Python interpreter/i.test(graded.feedback), graded.feedback);
  check('the feedback does not say the answer was wrong', !/^not quite/i.test(graded.feedback));

  // A wrong answer on a broken host must also not be called wrong — we cannot
  // know, so we must not claim.
  const unknown = await gradeCodeAnswer({ question: q({ expected_output: '4' }), code: 'print(999)' });
  check('an unverifiable answer is still not marked incorrect', unknown.verdict !== 'incorrect', unknown.verdict);

  delete process.env.LM_FORCE_RUNTIME_UNAVAILABLE;
  resetRuntimeCache();
}

{
  // With the runtime present, the same code is correctly graded — proving the
  // guard did not simply disable Python everywhere.
  const { resetRuntimeCache } = await import('../src/utils/sandbox.js');
  resetRuntimeCache();
  const ok = await gradeCodeAnswer({ question: q({ expected_output: '4' }), code: 'print(2 + 2)' });
  check('with Python installed the answer is verified', ok.verdict === 'correct', ok.verdict);
}

/* -------------------------------------------------------------------------- */
/* reported at the end                                                        */
/* -------------------------------------------------------------------------- */

console.log(`\n${failures.length ? '\x1b[31m' : '\x1b[32m'}${passed} passed, ${failures.length} failed\x1b[0m\n`);
if (failures.length) {
  for (const failure of failures) console.log(`  • ${failure}`);
  process.exit(1);
}
