/**
 * THE PARENT SIDE OF THE IN-PROCESS PYTHON INTERPRETER
 * ====================================================
 *
 * `python-worker.js` runs CPython in a worker thread. This module starts it,
 * feeds it one program, and — the part that matters — enforces the timeout by
 * terminating the worker. A hang becomes a timeout instead of a dead server.
 *
 * The interpreter is also *optional*. If the wasm runtime fails to load for any
 * reason, `runPython` returns `{ available: false }` and the caller keeps its
 * existing behaviour (static analysis, clearly labelled). A missing interpreter
 * must never be reported as a wrong answer.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const WORKER_URL = new URL('./python-worker.js', import.meta.url);
const TIME_LIMIT_MS = 5000;

/**
 * Whether this deployment can run Python at all.
 *
 * `LM_FORCE_RUNTIME_UNAVAILABLE=python` still wins, because that switch is the
 * test seam for the "no interpreter here" path and must keep working on a host
 * that *does* have one.
 */
export function pythonRuntimeDisabled() {
  return process.env.LM_FORCE_RUNTIME_UNAVAILABLE === 'python';
}

/**
 * Run one program and capture what it printed.
 *
 * @returns {Promise<{
 *   available: boolean,
 *   timedOut: boolean,
 *   stdout: string,
 *   error: string|null,
 * }>} `available: false` means the interpreter itself did not come up.
 */
export async function runPython(code, { timeoutMs = TIME_LIMIT_MS } = {}) {
  if (pythonRuntimeDisabled()) return { available: false, timedOut: false, stdout: '', error: null };

  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(WORKER_URL, {
        // Loading Wasm is CPU-bound and needs room; the timeout below is what
        // actually bounds the program, so this only guards against a stall.
        resourceLimits: { maxOldGenerationSizeMb: 512 },
        stdout: false,
        stderr: false,
      });
    } catch (error) {
      resolve({ available: false, timedOut: false, stdout: '', error: error?.message || String(error) });
      return;
    }

    let settled = false;
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // Terminating is how a runaway loop is stopped; the promise below is
      // already resolved, so the rejection that follows is not a problem.
      worker.terminate().catch(() => {});
      resolve(result);
    };

    worker.on('message', (message) => {
      if (message?.type === 'ready') {
        timer = setTimeout(
          () => finish({ available: true, timedOut: true, stdout: '', error: null }),
          timeoutMs,
        );
        worker.postMessage({ type: 'run', code });
        return;
      }
      if (message?.type === 'done') {
        finish({ available: true, timedOut: false, stdout: String(message.stdout || ''), error: null });
        return;
      }
      if (message?.type === 'error') {
        finish({ available: true, timedOut: false, stdout: String(message.stdout || ''), error: String(message.error || 'Python raised an error.') });
        return;
      }
      if (message?.type === 'loadfail') {
        finish({ available: false, timedOut: false, stdout: '', error: String(message.error || '') });
      }
    });

    worker.on('error', (error) => {
      finish({ available: false, timedOut: false, stdout: '', error: error?.message || String(error) });
    });

    worker.on('exit', () => {
      // Exited without reporting: treat as unavailable rather than as a pass.
      finish({ available: false, timedOut: false, stdout: '', error: 'The Python interpreter stopped unexpectedly.' });
    });

    // Startup budget: loading the wasm runtime takes a couple of seconds on a
    // cold container. If it never reports ready, do not hang the request.
    setTimeout(() => {
      if (!timer && !settled) {
        finish({ available: false, timedOut: false, stdout: '', error: 'The Python interpreter did not start in time.' });
      }
    }, Math.max(timeoutMs * 4, 20_000));
  });
}

/** Exported for tests: the path the worker is loaded from. */
export const pythonWorkerPath = fileURLToPath(WORKER_URL);
export const pythonWorkerDirectory = path.dirname(pythonWorkerPath);
