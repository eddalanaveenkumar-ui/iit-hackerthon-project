import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * THE COMPOSER STAYS PUT
 * ======================
 *
 * The input used to scroll away with the transcript, because the chat lived in a
 * page that grew without limit — `min-h-screen` lets content push the footer off
 * screen, so nothing inside could be pinned.
 *
 * Pinning needs a bounded ancestor chain: the shell must cap its height, `main`
 * must be allowed to shrink (`min-h-0`), and the page must fill what is left.
 * Those three are easy to delete by accident and impossible to see in a render
 * test, so they are asserted against the source.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), 'utf8');

describe('the tracs chat shell', () => {
  const layout = read('../components/Layout.jsx');
  const tracs = read('../pages/Tracs.jsx');

  it('bounds the shell height on tracs routes', () => {
    expect(layout).toMatch(/isFullHeight\(location\.pathname\)[^)]*\?\s*'h-dvh overflow-hidden'/);
  });

  it('lets main shrink so the inner scroller can engage', () => {
    expect(layout).toMatch(/isFullHeight\(location\.pathname\)\s*&&\s*'min-h-0'/);
  });

  it('bounds only a conversation, not the tracs index', () => {
    // This used to assert the *source text* of the rule, so it passed while the
    // rule itself was wrong: `/app/tracs` was treated as a chat shell, and the
    // upload page — which is taller than the viewport — could not scroll at all.
    // Test the behaviour, not the spelling.
    const source = layout.match(/function isFullHeight\(pathname\) \{\s*return (.+?);\s*\}/s);
    expect(source).toBeTruthy();
    const rule = new Function('pathname', `return ${source[1]};`);

    expect(rule('/app/tracs/abc123')).toBe(true);
    expect(rule('/app/tracs/abc123/')).toBe(true);
    expect(rule('/app/tracs')).toBe(false);
    expect(rule('/app/tracs/')).toBe(false);
    expect(rule('/app')).toBe(false);
  });

  it('fills that height in the page', () => {
    expect(tracs).toContain('flex h-full min-h-0 flex-col');
  });

  it('scrolls only the transcript, not the composer', () => {
    // The scroll container and the composer must be siblings: transcript
    // scrolls, composer does not.
    expect(tracs).toMatch(/flex-1 space-y-3 overflow-y-auto/);
    expect(tracs).toMatch(/border-t border-slate-200 bg-white px-3 pb-3 pt-2/);
  });

  it('uses the rounded ChatGPT-style composer', () => {
    expect(tracs).toContain('rounded-[26px]');
    // The composer must be the rounded pill, not the old flat box. The upload
    // textarea is a separate control and legitimately still square.
    const composer = tracs.slice(tracs.indexOf('rounded-[26px]'));
    expect(composer.slice(0, 400)).not.toMatch(/rounded-lg border/);
  });
});
