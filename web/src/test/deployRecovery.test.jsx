import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadForChunkError, clearChunkReloadFlag } from '../components/DynamicRenderer/chunkReload';
import vercelConfig from '../../vercel.json';

/**
 * RECOVERING FROM A DEPLOYMENT
 * ============================
 *
 * Reported from production: a /learn explanation rendered its heading and then
 * "This learning could not be displayed", with
 *
 *   Failed to load module script: Expected a JavaScript-or-Wasm module script
 *   but the server responded with a MIME type of "text/html"
 *
 * The browser had loaded `index.html` from an older deploy and was asking for
 * `LearningRenderer-Drb7wLUw.js`. That file no longer existed, and the catch-all
 * rewrite answered the request with `index.html` — HTML, served as a module.
 *
 * So the lesson was correct, the response was valid, and "the tutor's response
 * was malformed" was false. These are the three things that must not come back.
 */

describe('a chunk that fails to load is recognised', () => {
  const cases = [
    ['Chrome', 'Failed to fetch dynamically imported module: https://x/assets/LearningRenderer-Drb7wLUw.js'],
    ['Firefox', 'error loading dynamically imported module'],
    ['Safari', 'Importing a module script failed.'],
    ['MIME', 'Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"'],
  ];
  for (const [browser, message] of cases) {
    it(`recognises the ${browser} wording`, () => {
      expect(isChunkLoadError(new TypeError(message))).toBe(true);
    });
  }

  it('does not mistake a render error for a load error', () => {
    // Treating this as a load failure would reload the page instead of showing
    // the learner what actually broke.
    expect(isChunkLoadError(new TypeError('Cannot read properties of undefined (reading sections)'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('the reload is guarded', () => {
  const reload = vi.fn();
  beforeEach(() => {
    reload.mockReset();
    window.sessionStorage.clear();
    // jsdom will not navigate; assert on the call instead.
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it('reloads once', () => {
    expect(reloadForChunkError()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload a second time, so a broken chunk cannot loop', () => {
    reloadForChunkError();
    expect(reloadForChunkError()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('allows a reload again once the page has rendered', () => {
    reloadForChunkError();
    clearChunkReloadFlag();
    expect(reloadForChunkError()).toBe(true);
  });
});

describe('the deployment serves the app in a way that cannot cause this', () => {
  const rules = vercelConfig.rewrites || [];
  // A rewrite whose *source* targets /assets and sends it to the shell. The
  // catch-all mentions "assets" only in a negative lookahead, which is the fix.
  const assetsRewrite = rules.find((r) => /^\/assets\b/.test(r.source) && r.destination === '/index.html');
  const catchAll = rules.find((r) => r.destination === '/index.html');

  it('never rewrites a missing /assets file to the app shell', () => {
    // Serving index.html for a .js request is what produced the MIME error.
    expect(assetsRewrite).toBeUndefined();
    expect(catchAll.source).toMatch(/\(\?!assets\//);
  });

  it('never caches index.html', () => {
    // A cached shell points at the previous deploy's chunks.
    const indexHeader = (vercelConfig.headers || []).find(
      (h) => h.source === '/index.html' && h.headers.some((x) => /no-cache|no-store/.test(x.value)),
    );
    expect(indexHeader).toBeTruthy();
  });

  it('still caches the hashed assets for as long as it can', () => {
    // They are immutable; making them uncacheable would undo the point of hashing.
    const assetHeader = (vercelConfig.headers || []).find((h) => h.source === '/assets/(.*)');
    expect(assetHeader.headers[0].value).toMatch(/immutable/);
  });

  it('still proxies the API and keeps serving the app for real routes', () => {
    expect(rules.some((r) => r.source === '/api/:path*')).toBe(true);
    expect(catchAll).toBeTruthy();
  });
});
