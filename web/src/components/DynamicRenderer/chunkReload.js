/**
 * RECOVERING FROM A DEPLOYMENT
 * ============================
 *
 * Every renderer is a lazy chunk with a content hash in its name. A browser that
 * loaded `index.html` from an older deploy still holds that deploy's chunk
 * names; when the learner reaches a renderer that has not loaded yet, the
 * request goes to a file that no longer exists.
 *
 * On this deployment a request for a missing file used to be answered with
 * `index.html` — HTML, with a `text/html` content type — so the browser refused
 * it as a module ("Expected a JavaScript-or-Wasm module script... MIME type of
 * text/html"). The lesson rendered one section short and told the learner the
 * tutor's response was malformed, which was not true and was not their problem.
 *
 * Two things fix that, and this is the second one:
 *
 *   1. `vercel.json` no longer routes `/assets/*` to `index.html`, and no longer
 *      lets `index.html` be cached, so the stale reference is rare to begin with.
 *   2. When a chunk still fails, reload the page once. A fresh `index.html`
 *      carries the current chunk names and the lesson loads normally.
 *
 * The reload happens at most once per session. A loop guard is essential: if a
 * chunk is broken for a real reason, reloading forever would leave the learner
 * with a page that never settles.
 */

const KEY = 'lm.chunk.reload';

/**
 * Is this error a failed lazy import rather than a render error?
 *
 * Browsers word this differently — Chrome "Failed to fetch dynamically imported
 * module", Safari "Importing a module script failed", Firefox "error loading
 * dynamically imported module" — and the MIME variant arrives as a plain
 * TypeError with the message in it.
 */
export function isChunkLoadError(error) {
  const message = String(error?.message || error || '');
  return /dynamically imported module|importing a module script failed|error loading dynamically imported module|module script but the server responded|Failed to fetch/i.test(message);
}

/**
 * Reload once, in an attempt to pick up the current chunk names.
 *
 * @returns {boolean} true if a reload was started (so the caller should not
 *   also show an error), false if this session has already reloaded.
 */
export function reloadForChunkError() {
  try {
    if (window.sessionStorage.getItem(KEY) === '1') return false;
    window.sessionStorage.setItem(KEY, '1');
  } catch {
    // Private mode or a blocked storage partition: a reload is still better
    // than an error the learner cannot act on, but without the guard we could
    // loop. Prefer one reload and accept the small risk of a second.
  }
  window.location.reload();
  return true;
}

/** Called after a successful mount, so a later deploy can reload again. */
export function clearChunkReloadFlag() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
