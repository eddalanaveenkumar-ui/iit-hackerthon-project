/**
 * PYTHON, IN-PROCESS, SO IT WORKS ON A HOST WITHOUT PYTHON
 * ========================================================
 *
 * The sandbox used to shell out to `python3`. That is the right thing on a box
 * you control and the wrong thing on a serverless platform, whose Node image
 * ships no Python at all — so every submission came back "This server has no
 * Python interpreter installed" and was graded by static analysis instead. A
 * learner writing a correct program was told it could not be checked.
 *
 * This worker runs CPython inside the Node process, via Pyodide (CPython
 * compiled to WebAssembly). No system Python, no shell, nothing installed on the
 * host — it works anywhere Node works.
 *
 * WHY A WORKER THREAD AND NOT A DIRECT CALL
 * -----------------------------------------
 * Pyodide is synchronous inside the process that hosts it. A direct call to
 * `while True: pass` does not time out, it *hangs the server permanently* —
 * measured, not theorised. A worker thread can be terminated from outside, so
 * the timeout is real: `worker.terminate()` kills the interpreter mid-loop. That
 * is the entire reason this file exists rather than twenty inline lines.
 *
 * The worker is also fresh per submission, so one learner's globals, imports and
 * recursion-limit changes cannot leak into another's.
 *
 * This module is loaded by `python-interpreter.js`, which owns the parent side.
 */

import { parentPort } from 'node:worker_threads';
import { loadPyodide } from 'pyodide';

let stdout = '';

/** Both streams are collected: a traceback is part of what the learner sees. */
const collect = (line) => {
  if (stdout.length < 200_000) stdout += `${line}\n`;
};

/**
 * The submission is compiled and exec'd by *our* driver rather than handed
 * straight to `runPythonAsync`.
 *
 * Two reasons, both visible to the learner. Pyodide's own entry point puts its
 * internal frames (`_pyodide/_base.py`, `eval_code_async`) at the top of every
 * traceback, which reads as noise from our machinery; compiling with the
 * filename `<submission>` and formatting the traceback here means the learner
 * sees only their own code. And `SyntaxError` arrives as a clean one-paragraph
 * message instead of a stack of interpreter internals.
 */
const DRIVER = `
import sys, traceback

__lm_result = {}
try:
    exec(compile(__lm_code, '<submission>', 'exec'), {'__name__': '__main__', '__builtins__': __builtins__})
except SystemExit:
    pass
except BaseException:
    # Drop our own driver frame: the learner's first line of interest is theirs.
    __lm_err = traceback.format_exc()
    __lm_lines = __lm_err.splitlines(True)
    __lm_result['error'] = ''.join(
        line for line in __lm_lines if '<exec>' not in line
    )
`;

let py = null;
let loadError = null;

try {
  py = await loadPyodide({ stdout: collect, stderr: collect });
} catch (error) {
  loadError = error?.message || String(error);
}

if (loadError) {
  parentPort.postMessage({ type: 'loadfail', error: loadError });
} else {
  parentPort.postMessage({ type: 'ready' });
}

parentPort.on('message', async (message) => {
  if (message?.type !== 'run') return;
  stdout = '';
  try {
    // The submitted source is passed as a Python value, never interpolated into
    // the driver, so it cannot break out of it.
    py.globals.set('__lm_code', String(message.code ?? ''));
    await py.runPythonAsync(DRIVER);
    const failure = py.runPython("__lm_result.get('error')");

    if (failure) {
      parentPort.postMessage({ type: 'error', error: String(failure), stdout });
    } else {
      parentPort.postMessage({ type: 'done', stdout });
    }
  } catch (unexpected) {
    // Only our own driver can fail here; report it as an error, never as a pass.
    parentPort.postMessage({ type: 'error', error: unexpected?.message || String(unexpected), stdout });
  }
});
