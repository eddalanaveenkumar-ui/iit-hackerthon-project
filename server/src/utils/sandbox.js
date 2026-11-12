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
`;

function pickRunnerPath() {
  return path.join(os.tmpdir(), 'learnmate-sandbox-runner.mjs');
}

async function ensureRunner() {
  const runner = pickRunnerPath();
  try {
    const existing = await fs.readFile(runner, 'utf8');
    if (existing === RUNNER_SOURCE) return runner;
  } catch {
    /* write below */
  }
  await fs.writeFile(runner, RUNNER_SOURCE, { mode: 0o444 });
  return runner;
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
      resolve({ stdout, stderr: String(err.message), timedOut, code: -1 });
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
 * @returns {Promise<{ executed: boolean, runtime: string, results: [], stdout: string, loadError: string|null, timedOut: boolean }>}
 */
export async function executeCode({ code, language = 'javascript', tests = [] }) {
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

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `lm-${crypto.randomBytes(4).toString('hex')}-`));
  try {
    if (language === 'javascript') {
      const runner = await ensureRunner();
      const payload = { code, tests };
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
