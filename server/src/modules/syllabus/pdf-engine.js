/**
 * pdfjs-dist loader.
 *
 * Why this file exists: pdfjs needs a "worker" module. In Node there is no Web
 * Worker, so it falls back to a *fake worker* — which it loads with a dynamic
 * `import(GlobalWorkerOptions.workerSrc)`. That is a runtime string, so no
 * bundler can see it, and on Vercel the file is never included in the function
 * bundle. The result is the production-only error:
 *
 *   Setting up fake worker failed: "Cannot find module
 *   '/var/task/server/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'"
 *
 * The same code works locally because node_modules is fully present there, which
 * is exactly why this has to be fixed at the bundler level rather than with a
 * more careful path.
 *
 * Two changes make it work everywhere:
 *
 *  1. Import the worker with a **static specifier** and attach it to
 *     `globalThis.pdfjsWorker`. pdfjs checks that global before ever looking at
 *     `workerSrc`, so the file is resolved by normal module resolution and is
 *     guaranteed to be traced into the deployment.
 *  2. Build the document with `verbosity: 0` and no standard font data, because
 *     we only read the text layer — never render — so font metrics are not
 *     needed. Without a `standardFontDataUrl` pdfjs warns on every PDF that uses
 *     a base-14 font (most of them).
 */

let enginePromise = null;

/** Loads pdfjs once and installs the worker on the global. */
export function loadPdfjs() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

      // Static specifier on purpose: the bundler must be able to resolve it.
      // Assigning the namespace mirrors what the browser build does, and pdfjs
      // prefers it over the dynamic workerSrc import.
      if (!globalThis.pdfjsWorker) {
        try {
          globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
        } catch (err) {
          // Not fatal: if the worker is genuinely absent, getDocument() will
          // throw a message that names the file, and extractPdf wraps it.
          console.error('[pdf] could not preload the worker module:', err.message);
        }
      }
      return pdfjs;
    })().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

/**
 * Opens a PDF for text extraction.
 *
 * `useWorkerFetch`/`isEvalSupported` are off because a serverless sandbox has no
 * fetch base URL and evaluating embedded JS from an uploaded document is not
 * something this app should ever do.
 */
export async function openPdf(buffer) {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    // Text extraction only — no canvas, no font data needed.
    verbosity: 0,
  }).promise;
}
