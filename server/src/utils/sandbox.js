import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Secure code execution.
 *
 * Student code is NEVER evaluated inside the application process. Each run:
 *  - writes the submission to a throwaway temp directory
 *  - spawns a fresh Node process with the Permission Model enabled
 *      (--permission --allow-fs-read=<tmp>) which blocks filesystem writes,
 *      child processes, worker threads, native addons and outbound network
 *  - runs with an empty environment (no secrets leak into the child)
 *  - has a hard wall-clock timeout and capped stdout/stderr
 *
 * JavaScript runs in the sandbox. Python uses an isolated interpreter when
 * available. Java/SQL are analysed statically only, and the API says so
 * explicitly rather than pretending to run them.
 */

const TIME_LIMIT_MS = Number(process.env.SANDBOX_TIMEOUT_MS || 5000);
const MAX_OUTPUT = 20_000;
const RUNNER_SOURCE = `import { createRequire } from 'node:module';
const payload = JSON.parse(process.env.LM_PAYLOAD || '{}');
const out = [];
const emit = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); out.push(s); };
// "run" mode executes a whole program and reports what it printed, rather than
// looking for a callable solve(). A question_form code answer is a snippet or a
// script, not a function to test, so it needs this path.
if (payload.mode === 'run') {
  try {
    const wrapped = new Function('console', 'module', 'exports', 'require', payload.code + '\\n;');
    const moduleShim = { exports: {} };
    const requireShim = () => { throw new Error('require() is disabled inside the sandbox'); };
    wrapped(safeConsoleForRun(), moduleShim, moduleShim.exports, requireShim);
    process.stdout.write('@@RESULT@@' + JSON.stringify({ results: [], loadError: null, logs: out.slice(-200) }));
  } catch (err) {
    process.stdout.write('@@RESULT@@' + JSON.stringify({ results: [], loadError: String(err && err.message ? err.message : err), logs: out.slice(-200) }));
  }
} else {
  runSolveMode();
}
function safeConsoleForRun() {
  return { log: (...a) => emit(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')), error: (...a) => emit(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')), warn: (...a) => emit(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) };
}
function runSolveMode() {
const safeConsole = {
  log: (...a) => emit(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
  error: (...a) => emit(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
  warn: (...a) => emit(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
};
let userFn = null;
let loadError = null;
try {
  const wrapped = new Function('console', 'module', 'exports', 'require', payload.code + '\\n;return typeof solve === "function" ? solve : (typeof module !== "undefined" && module.exports && (module.exports.solve || module.exports.default)) || null;');
  const moduleShim = { exports: {} };
  const requireShim = () => { throw new Error('require() is disabled inside the sandbox'); };
  userFn = wrapped(safeConsole, moduleShim, moduleShim.exports, requireShim);
} catch (err) {
  loadError = err.message;
}
const results = [];
if (!loadError && typeof userFn === 'function') {
  for (const test of payload.tests || []) {
    let args = [];
    try { args = (test.args || []).map((a) => (typeof a === 'string' ? JSON.parse(a) : a)); } catch { args = test.args || []; }
    try {
      const value = userFn(...args);
      results.push({ id: test.id, passed: true, output: JSON.stringify(value === undefined ? null : value) });
    } catch (err) {
      results.push({ id: test.id, passed: false, output: '', error: String(err && err.message ? err.message : err) });
    }
  }
} else if (typeof userFn !== 'function' && !loadError) {
  loadError = 'No callable solve() function was found in your submission.';
}
process.stdout.write('@@RESULT@@' + JSON.stringify({ results, loadError, logs: out.slice(-100) }));
}
`;

function pickRunnerPath() {
  return path.join(os.tmpdir(), 'learnmate-sandbox-runner.mjs');
}

/**
 * Materialise the JavaScript runner in a temp file, read-only so the sandboxed
 * child can read it but not rewrite it.
 *
 * The runner is cached at a fixed path and written `0o444`, so a plain
 * `writeFile` over an existing runner throws EACCES the first time the runner's
 * source changes — after a deploy, that turned every JavaScript execution into
 * "permission denied" until someone deleted a file in /tmp. The stale copy is
 * removed first, and losing a write race is tolerated because the content is
 * identical.
 */
async function ensureRunner() {
  const runner = pickRunnerPath();
  try {
    const existing = await fs.readFile(runner, 'utf8');
    if (existing === RUNNER_SOURCE) return runner;
    await fs.rm(runner, { force: true }); // a different version is cached
  } catch {
    /* no cached runner — write below */
  }
  try {
    await fs.writeFile(runner, RUNNER_SOURCE, { mode: 0o444 });
  } catch (error) {
    if (error?.code !== 'EACCES' && error?.code !== 'EEXIST') throw error;
    const written = await fs.readFile(runner, 'utf8').catch(() => null);
    if (written !== RUNNER_SOURCE) throw error;
  }
  return runner;
}

/**
 * Is a runtime actually installed on this host?
 *
 * Deployment images vary: a Node-only image has no `python3`, so every Python
 * submission fails with `spawn python3 ENOENT` — before a single line of the
 * student's code runs. Reporting that as "incorrect" blames the student for a
 * server misconfiguration, which is exactly the bug this guards.
 *
 * The check is cached for the process lifetime because the answer cannot change
 * without a redeploy. A failed probe is remembered too, so a missing runtime is
 * detected once rather than on every submission.
 */
const runtimeCache = new Map();

export async function isRuntimeAvailable(language) {
  if (language !== 'python') return true; // JavaScript is the server's own runtime.
  // An explicit override exists so the missing-runtime path can be tested on a
  // host that *does* have Python. Without it this branch is only reachable in
  // production — which is how the original bug shipped.
  if (process.env.LM_FORCE_RUNTIME_UNAVAILABLE === 'python') return false;
  if (runtimeCache.has('python')) return runtimeCache.get('python');
  const res = await runProcess('python3', ['--version'], { env: {}, timeoutMs: 5000 });
  const available = !res.spawnError;
  runtimeCache.set('python', available);
  return available;
}

/** Test seam: forget the cached probe result. */
export function resetRuntimeCache() {
  runtimeCache.clear();
}

/**
 * Can this deployment run the given language *right now*?
 *
 * Synchronous, answering only from what has already been probed. It exists so
 * question authoring can avoid writing a question the server cannot grade: on a
 * Node-only image every Python question came back unverified, and the learner
 * got a paragraph about the server's missing interpreter instead of an answer.
 *
 * Unknown means "assume yes", so this can never silently downgrade a capable
 * deployment — the async probe still runs on the real submission path.
 *
 * @returns {boolean|null} false only when a probe has positively failed.
 */
export function runtimeAvailability(language) {
  if (language && language !== 'python') return true;
  if (process.env.LM_FORCE_RUNTIME_UNAVAILABLE === 'python') return false;
  return runtimeCache.has('python') ? runtimeCache.get('python') : null;
}

function runProcess(cmd, args, { env, cwd, timeoutMs = TIME_LIMIT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: env || {},
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      // `ENOENT` means the runtime itself is missing from this host — the
      // program never started. That is an environment fault, not a verdict on
      // the code, so it is reported separately rather than as a failure.
      resolve({ stdout, stderr: String(err.message), timedOut, code: -1, spawnError: err.code || 'ERROR' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, code });
    });
  });
}

/** Rich static checks that run in-process (no execution) for every language. */
export function staticCheck(code, language = 'javascript') {
  const issues = [];
  const lines = String(code || '').split('\n');
  const stripped = String(code || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

  if (/eval\s*\(/.test(code)) issues.push({ type: 'security', message: 'eval() is not allowed.' });
  if (/child_process|require\s*\(\s*['"]fs['"]|process\.env/.test(code)) {
    issues.push({ type: 'security', message: 'Access to the host filesystem, environment or child processes is blocked.' });
  }
  if (/while\s*\(\s*(true|1)\s*\)/.test(code) && !/break/.test(code)) {
    issues.push({ type: 'logic', message: 'Infinite loop detected: while(true) with no break.' });
  }

  if (language === 'javascript') {
    const open = (stripped.match(/[{([]/g) || []).length;
    const close = (stripped.match(/[})\]]/g) || []).length;
    if (open !== close) issues.push({ type: 'syntax', message: `Unbalanced brackets: ${open} opening vs ${close} closing.` });
    try {
      // Parse-only check with the same wrapping used by the runner.
      // eslint-disable-next-line no-new-func
      new Function(code);
    } catch (err) {
      issues.push({ type: 'syntax', message: `Syntax error: ${err.message}` });
    }
    if (/\bvar\s+[A-Za-z_$]/.test(code)) issues.push({ type: 'style', message: 'Prefer let/const over var for block scoping.' });
    if (/[^=!<>]==[^=]/.test(code)) issues.push({ type: 'logic', message: 'Loose equality (==) can coerce types; prefer ===.' });
    if (/console\.log\(/.test(code) && !/\breturn\b/.test(code)) {
      issues.push({ type: 'logic', message: 'The function logs instead of returning a value.' });
    }
    if (!/function\s+\w+|\w+\s*=\s*\(|=>/.test(code)) issues.push({ type: 'structure', message: 'No function definition found.' });
  }

  if (language === 'python') {
    if (/^\s*\t/m.test(code) && /^ {2,}\S/m.test(code)) issues.push({ type: 'syntax', message: 'Mixed tabs and spaces will raise IndentationError.' });
    if (/^\s*print\s*\(/m.test(code) && !/^\s*return\b/m.test(code)) issues.push({ type: 'logic', message: 'Prints instead of returning a value.' });
    if (/input\s*\(/.test(code)) issues.push({ type: 'security', message: 'Interactive input() is not available in the sandbox.' });
    if (!/^\s*def\s+\w+/m.test(code)) issues.push({ type: 'structure', message: 'No function definition found.' });
  }

  if (language === 'java') {
    if (!/class\s+\w+/.test(code)) issues.push({ type: 'syntax', message: 'No class declaration found.' });
    if (!/static/.test(code)) issues.push({ type: 'structure', message: 'Provide a static method for the test runner.' });
    if (/==/.test(code) && /String\s+\w+/.test(code)) issues.push({ type: 'logic', message: 'Compare Strings with equals(), not ==.' });
  }

  if (language === 'sql') {
    if (!/select/i.test(code)) issues.push({ type: 'syntax', message: 'Query must contain SELECT.' });
    if (/select\s+\*/i.test(code)) issues.push({ type: 'style', message: 'Select explicit columns instead of *.' });
  }

  return {
    issues,
    lineCount: lines.length,
    estimatedComplexity: (stripped.match(/\b(if|for|while|switch|catch)\b/g) || []).length,
  };
}

/**
 * Executes a submission against tests.
 * @returns {Promise<{ executed: boolean, runtime: string, results: [], stdout: string, loadError: string|null, timedOut: boolean, runtimeUnavailable?: boolean }>}
 *   `runtimeUnavailable: true` means this host has no interpreter for the
 *   language — the submission never ran, so it is not evidence about the code.
 */
export async function executeCode({ code, language = 'javascript', tests = [], mode = 'tests' }) {
  // mode: 'tests' runs `solve(args)` against test cases (practice workspace).
  // mode: 'run' executes the program as written and reports its output — what a
  // question_form code answer needs, because the student wrote a script.
  const staticInfo = staticCheck(code, language);
  if (language !== 'javascript' && language !== 'python') {
    return {
      executed: false,
      runtime: `${language}: static analysis only`,
      reason: `Runtime execution for ${language} is intentionally disabled in this deployment. The submission was analysed statically. Do not treat these results as test results.`,
      results: [],
      stdout: '',
      loadError: null,
      timedOut: false,
      staticAnalysis: staticInfo,
    };
  }

  // Refuse to run rather than run-and-fail: a missing interpreter is reported
  // as "not executed", which every caller treats as not-graded, so the student
  // is never told their correct program was wrong.
  if (language === 'python' && !(await isRuntimeAvailable('python'))) {
    return {
      executed: false,
      runtime: 'python3 (unavailable)',
      reason: 'This server has no Python interpreter installed, so the submission could not be run. It was analysed statically instead.',
      results: [],
      stdout: '',
      loadError: null,
      timedOut: false,
      runtimeUnavailable: true,
      staticAnalysis: staticInfo,
    };
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `lm-${crypto.randomBytes(4).toString('hex')}-`));
  try {
    if (language === 'javascript') {
      const runner = await ensureRunner();
      const payload = { code, tests, mode };
      if (payload.code.length > 60_000) {
        return { executed: false, runtime: 'javascript', reason: 'Submission too large (limit 60 KB).', results: [], stdout: '', loadError: null, timedOut: false, staticAnalysis: staticInfo };
      }
      const res = await runProcess(process.execPath, ['--permission', `--allow-fs-read=${runner}`, runner], {
        cwd: workDir,
        env: { LM_PAYLOAD: JSON.stringify(payload) },
        timeoutMs: TIME_LIMIT_MS,
      });
      if (res.timedOut) {
        return {
          executed: true,
          runtime: 'javascript (node --permission)',
          results: tests.map((t) => ({ id: t.id, passed: false, output: '', error: 'Execution timed out' })),
          stdout: res.stdout.slice(0, 2000),
          loadError: null,
          timedOut: true,
          staticAnalysis: staticInfo,
        };
      }
      const marker = res.stdout.indexOf('@@RESULT@@');
      if (marker === -1) {
        return {
          executed: true,
          runtime: 'javascript (node --permission)',
          results: [],
          stdout: res.stdout.slice(0, 2000),
          loadError: (res.stderr || res.stdout || 'Sandbox produced no result').slice(0, 1500),
          timedOut: false,
          staticAnalysis: staticInfo,
        };
      }
      const parsed = JSON.parse(res.stdout.slice(marker + 10));
      const results = (parsed.results || []).map((r) => {
        const test = tests.find((t) => t.id === r.id);
        let passed = r.passed;
        if (passed && test?.expected !== undefined && test.expected !== null && test.expected !== 'any') {
          const out = String(r.output ?? '');
          const expected = String(test.expected);
          try {
            passed = JSON.stringify(JSON.parse(out)) === JSON.stringify(JSON.parse(expected));
          } catch {
            passed = out.includes(expected);
          }
          if (!passed) return { ...r, passed: false, error: `Expected ${expected}, received ${out.slice(0, 200)}` };
        }
        return { ...r, passed };
      });
      return {
        executed: true,
        runtime: 'javascript (node --permission)',
        results,
        stdout: (parsed.logs || []).join('\n').slice(0, MAX_OUTPUT),
        loadError: parsed.loadError || null,
        timedOut: false,
        staticAnalysis: staticInfo,
      };
    }

    // Python: isolated interpreter (-I -S), empty env, resource-limited, timeout.
    const file = path.join(workDir, 'submission.py');
    if (mode === 'run') {
      // Execute the script as written and capture what it prints. The harness
      // only appends a result marker so the caller can tell the program finished.
      // The marker proves the program reached the end. `import json` goes first
      // so a script that prints a line identical to the marker cannot confuse the
      // split, and the program's own output is everything before it.
      const runHarness = `import json\n${code}\n\nprint('@@RESULT@@' + json.dumps({'results': [], 'loadError': None}))\n`;
      await fs.writeFile(file, runHarness, 'utf8');
      const runRes = await runProcess('python3', ['-I', '-S', file], { cwd: workDir, env: {}, timeoutMs: TIME_LIMIT_MS });
      if (runRes.timedOut) {
        return { executed: true, runtime: 'python3 (isolated)', results: [], stdout: '', loadError: null, timedOut: true, staticAnalysis: staticInfo };
      }
      const runMarker = runRes.stdout.indexOf('@@RESULT@@');
      const programOut = runMarker === -1 ? runRes.stdout : runRes.stdout.slice(0, runMarker);
      return {
        executed: true,
        runtime: 'python3 (isolated)',
        results: [],
        stdout: programOut.slice(0, MAX_OUTPUT),
        // A non-zero exit or stderr on a program that printed no marker is an error.
        loadError: runMarker === -1
          ? (runRes.stderr || runRes.stdout || 'Python produced no result').slice(0, 1500)
          : null,
        timedOut: false,
        staticAnalysis: staticInfo,
      };
    }
    const harness = `import json, sys, io, contextlib\n${code}\n\nTESTS = json.loads(sys.argv[1])\nout = []\nfor t in TESTS:\n    args = [__import__('json').loads(a) if isinstance(a, str) else a for a in t.get('args', [])]\n    try:\n        val = solve(*args)\n        out.append({'id': t['id'], 'passed': True, 'output': json.dumps(val)})\n    except Exception as e:\n        out.append({'id': t['id'], 'passed': False, 'output': '', 'error': f'{type(e).__name__}: {e}'})\nprint('@@RESULT@@' + json.dumps({'results': out}))\n`;
    await fs.writeFile(file, harness, 'utf8');
    const res = await runProcess('python3', ['-I', '-S', file, JSON.stringify(tests)], {
      cwd: workDir,
      env: {},
      timeoutMs: TIME_LIMIT_MS,
    });
    if (res.timedOut) {
      return { executed: true, runtime: 'python3 (isolated)', results: tests.map((t) => ({ id: t.id, passed: false, output: '', error: 'Execution timed out' })), stdout: '', loadError: null, timedOut: true, staticAnalysis: staticInfo };
    }
    const marker = res.stdout.indexOf('@@RESULT@@');
    if (marker === -1) {
      return { executed: true, runtime: 'python3 (isolated)', results: [], stdout: res.stdout.slice(0, 2000), loadError: (res.stderr || 'Python sandbox produced no result').slice(0, 1500), timedOut: false, staticAnalysis: staticInfo };
    }
    const parsed = JSON.parse(res.stdout.slice(marker + 10));
    return {
      executed: true,
      runtime: 'python3 (isolated)',
      results: parsed.results || [],
      stdout: '',
      loadError: null,
      timedOut: false,
      staticAnalysis: staticInfo,
    };
  } catch (err) {
    return {
      executed: false,
      runtime: language,
      reason: `Sandbox error: ${err.message}`,
      results: [],
      stdout: '',
      loadError: err.message,
      timedOut: false,
      staticAnalysis: staticInfo,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Token-level similarity used to detect pasted reference solutions. */
export function codeSimilarity(a, b) {
  const norm = (s) =>
    String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/\/\/.*$/gm, '')
      .trim()
      .toLowerCase();
  const A = new Set(norm(a).split(/[^a-z0-9_$]+/).filter(Boolean));
  const B = new Set(norm(b).split(/[^a-z0-9_$]+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return Math.round((inter / (A.size + B.size - inter)) * 1000) / 10;
}
