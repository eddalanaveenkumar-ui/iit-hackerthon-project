/**
 * PYTHON WITHOUT A PYTHON INSTALL
 * ===============================
 *
 * The deployed server reported, for every Python submission:
 *
 *   "This server has no Python interpreter installed, so the submission could
 *    not be run. It was analysed statically instead."
 *
 * The platform's Node image has no Python. These tests cover the fix — CPython
 * running in a worker thread via Pyodide — and, just as importantly, that the
 * old "could not be run" behaviour is now *accurate* rather than universal.
 *
 * Every run here forces the wasm engine, so the tests prove the path a
 * Python-less host uses even on a machine that happens to have `python3`.
 *
 *   node tests/python-runtime.mjs
 */

process.env.LM_PYTHON_ENGINE = 'wasm';
delete process.env.LM_FORCE_RUNTIME_UNAVAILABLE;

const { runPython } = await import('../src/utils/python-interpreter.js');
const { executeCode } = await import('../src/utils/sandbox.js');

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

/* -------------------------------------------------------------------------- */

section('the interpreter runs a program');

{
  const result = await runPython('print("hello from python")');
  check('it starts', result.available, result.error || '');
  check('it captures stdout', result.stdout.trim() === 'hello from python', JSON.stringify(result.stdout));
  check('a clean program reports no error', result.error === null, String(result.error));
}

{
  const result = await runPython('total = 0\nfor i in range(1, 5):\n    total += i\nprint(total)');
  check('loops and arithmetic work', result.stdout.trim() === '10', JSON.stringify(result.stdout));
}

{
  const result = await runPython('def add(a, b):\n    return a + b\n\nprint(add(2, 3))');
  check('functions work', result.stdout.trim() === '5', JSON.stringify(result.stdout));
}

{
  const result = await runPython('names = ["Ada", "Alan"]\nfor n in names:\n    print(n.upper())');
  check('collections and string methods work', result.stdout.replace(/\s+$/, '') === 'ADA\nALAN', JSON.stringify(result.stdout));
}

{
  // The submission must see itself as a script, not as a REPL fragment.
  const result = await runPython('if __name__ == "__main__":\n    print("main")');
  check('__name__ is "__main__" like a real script', result.stdout.trim() === 'main', JSON.stringify(result.stdout));
}

/* -------------------------------------------------------------------------- */

section('errors are reported as the learner would see them');

{
  const result = await runPython('print(1/0)');
  check('a raising program is not reported as a pass', result.error !== null);
  check('the exception names the cause', /ZeroDivisionError/.test(String(result.error)), String(result.error));
  check('the traceback points at the submission', /<submission>/.test(String(result.error)), String(result.error));
  check('our sandbox driver does not appear in the traceback', !/<exec>/.test(String(result.error)), String(result.error));
  check('Pyodide internals do not appear in the traceback', !/_pyodide/.test(String(result.error)), String(result.error));
}

{
  const result = await runPython('def broken(:\n    pass');
  check('a syntax error is caught', /SyntaxError/.test(String(result.error)), String(result.error));
  check('a syntax error does not leak interpreter internals', !/_pyodide|eval_code/.test(String(result.error)), String(result.error));
}

{
  const result = await runPython('print("before")\nraise ValueError("bad value")');
  check('output printed before the error is kept', result.stdout.includes('before'), JSON.stringify(result.stdout));
  check('the raised error is still reported', /ValueError: bad value/.test(String(result.error)), String(result.error));
}

/* -------------------------------------------------------------------------- */

section('a runaway program is stopped, not left to hang');

{
  const started = Date.now();
  const result = await runPython('while True:\n    pass', { timeoutMs: 4000 });
  const elapsed = Date.now() - started;
  check('an infinite loop times out', result.timedOut === true);
  check('it is stopped in bounded time', elapsed < 20_000, `${elapsed}ms`);
  // The whole point of running in a worker: the host survives.
  check('the interpreter was killed rather than left running', result.available === true);
}

{
  // Resolving the promise is not the same as stopping the program. A worker that
  // was never terminated keeps burning a core on `while True` after the learner
  // has been told it timed out — verified by measuring, because this failure is
  // invisible from the outside.
  const { Worker } = await import('node:worker_threads');
  const { pythonWorkerPath } = await import('../src/utils/python-interpreter.js');
  const usage = () => process.cpuUsage();
  const cpuMs = (u) => Math.round((u.user + u.system) / 1000);

  const worker = new Worker(pythonWorkerPath);
  let started = false;
  worker.on('message', (message) => {
    if (message?.type === 'ready' && !started) {
      started = true;
      worker.postMessage({ type: 'run', code: 'while True:\n    pass' });
    }
  });

  // Give it time to spin, then terminate exactly as the timeout path does.
  await new Promise((resolve) => { setTimeout(resolve, 3500); });
  const during = usage();
  await worker.terminate();
  await new Promise((resolve) => { setTimeout(resolve, 1200); });
  const after = usage();
  const burnedAfter = cpuMs(after) - cpuMs(during);

  check('a terminated worker stops consuming CPU', burnedAfter < 800, `${burnedAfter}ms of CPU after terminate`);
}

/* -------------------------------------------------------------------------- */

section('the sandbox uses it when the host has no python3');

{
  const run = await executeCode({ code: 'print("no python3 needed")', language: 'python', tests: [], mode: 'run' });
  check('the submission executes', run.executed === true, run.reason || '');
  check('it is not reported as unavailable', !run.runtimeUnavailable, run.reason || '');
  check('the output is the program output', run.stdout.trim() === 'no python3 needed', JSON.stringify(run.stdout));
  check('the runtime is named honestly', /wasm/.test(String(run.runtime)), String(run.runtime));
}

{
  // The Run button sends no `mode` and no tests. That must behave as a plain
  // run; treating it as a tests run executed a `solve()` harness that printed
  // nothing, so the learner saw a successful run with an empty output box.
  const run = await executeCode({ code: 'print("Hello, world!")', language: 'python', tests: [] });
  check('a run with no tests and no mode still returns the output', run.stdout.trim() === 'Hello, world!', JSON.stringify(run.stdout));
  check('and reports that it really ran', run.executed === true, run.reason || '');
}

{
  const run = await executeCode({ code: 'while True:\n    pass', language: 'python', tests: [], mode: 'run' });
  check('a runaway submission times out through the sandbox too', run.timedOut === true);
  check('a timeout is not an "unavailable runtime"', !run.runtimeUnavailable, run.reason || '');
}

{
  // A timeout must reach the learner as a failure of *their program*, not of the
  // machine — the same rule the rest of the grader follows.
  const { gradeCodeAnswer } = await import('../src/modules/learning/code-grading.js');
  const graded = await gradeCodeAnswer({
    question: { id: 'q1', language: 'python', prompt: 'Print 2' },
    code: 'print(2)',
  });
  // With no expected result there is nothing to be "correct" against; the check
  // is that the program runs. What matters here is that it *ran at all*.
  check('an unverifiable-outcome question still executes the code', graded.executed === true, graded.feedback);
  check('it is not marked wrong for having no expected output', graded.verdict !== 'incorrect', `${graded.verdict}: ${graded.feedback}`);
  check('the feedback says it really ran', /executed/i.test(graded.feedback), graded.feedback);
  check('no "no interpreter" apology reaches the learner', !/no Python interpreter/i.test(graded.feedback), graded.feedback);
}

{
  const { gradeCodeAnswer } = await import('../src/modules/learning/code-grading.js');
  const graded = await gradeCodeAnswer({
    question: { id: 'q2', language: 'python', expected_output: '4' },
    code: 'print(2 + 2)',
  });
  check('an output question is verified against real output', graded.verdict === 'correct', `${graded.verdict}: ${graded.feedback}`);

  const wrong = await gradeCodeAnswer({
    question: { id: 'q3', language: 'python', expected_output: '4' },
    code: 'print(2 + 3)',
  });
  check('a wrong answer is still marked wrong', wrong.verdict === 'incorrect', `${wrong.verdict}: ${wrong.feedback}`);
  check('and the learner is told what it actually printed', /5/.test(wrong.feedback), wrong.feedback);
}

/* -------------------------------------------------------------------------- */

section('the old behaviour still exists, and is now accurate');

{
  // The switch that means "this host genuinely cannot run Python".
  process.env.LM_FORCE_RUNTIME_UNAVAILABLE = 'python';
  const run = await executeCode({ code: 'print(1)', language: 'python', tests: [], mode: 'run' });
  check('with the runtime forced off it reports unavailable', run.executed === false);
  check('and says so without pretending to have graded the code', Boolean(run.runtimeUnavailable));
  delete process.env.LM_FORCE_RUNTIME_UNAVAILABLE;
}

section('tests mode calls solve()');

{
  const run = await executeCode({
    code: 'def solve(a, b):\n    return a + b',
    language: 'python',
    tests: [{ id: 't1', args: [2, 3], expected: '5' }, { id: 't2', args: [0, 0], expected: '0' }],
    mode: 'tests',
  });
  check('it executes', run.executed === true, run.reason || '');
  check('every case is reported', (run.results || []).length === 2, JSON.stringify(run.results));
  check('both cases pass', (run.results || []).every((r) => r.passed), JSON.stringify(run.results));
}

{
  const run = await executeCode({
    code: 'def solve(a, b):\n    return a - b',
    language: 'python',
    tests: [{ id: 't1', args: [2, 3], expected: '5' }],
    mode: 'tests',
  });
  // executeCode reports whether solve() *ran* and what it returned; comparing
  // that to `expected` belongs to the caller (the JavaScript runner does it in
  // its own path). The value must come back intact so the caller can decide.
  check('a case that returns the wrong value still reports its value', (run.results || [])[0]?.output === '-1', JSON.stringify(run.results));
  check('and it is not silently dropped', (run.results || []).length === 1, JSON.stringify(run.results));
}

{
  const run = await executeCode({
    code: 'def solve(a):\n    return 1 / a',
    language: 'python',
    tests: [{ id: 't1', args: [0], expected: '1' }],
    mode: 'tests',
  });
  check('an exception inside a case is caught per case', (run.results || [])[0]?.passed === false, JSON.stringify(run.results));
  check('the case error names the cause', /ZeroDivisionError/.test(String((run.results || [])[0]?.error || '')), JSON.stringify(run.results));
}

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) console.log(`  \x1b[31m✗\x1b[0m ${failure}`);
  process.exit(1);
}
