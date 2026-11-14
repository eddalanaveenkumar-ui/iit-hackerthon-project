import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * BUNDLE GUARD
 * ============
 *
 * The chat is the first page loaded, so what is in the entry chunk is what the
 * learner waits for. This failed silently once already: `await import('lucide-
 * react')` in a shared renderer turned into a namespace import, so all 2 350
 * icons were bundled (839 kB), and a `charts` manual chunk attached 463 kB of
 * recharts to the entry — before the conversation could paint.
 *
 * A test can't measure a build that isn't run here, so it guards the *source*
 * conditions that caused it. `npm run build` in CI covers the output.
 */

const ROOT = join(__dirname, '..', '..', 'src');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Strip comments — these files discuss the very patterns being banned. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FILES = walk(ROOT).map((path) => {
  const raw = readFileSync(path, 'utf8');
  return { path, raw, text: stripComments(raw) };
});

describe('the entry bundle stays small', () => {
  it('never imports the whole icon set', () => {
    // `import * as icons from 'lucide-react'` and `await import('lucide-react')`
    // both defeat tree-shaking for every icon in the library.
    const offenders = FILES.filter(({ text }) =>
      /import\s*\*\s*as\s+\w+\s+from\s+['"]lucide-react['"]/.test(text) ||
      /import\(\s*['"]lucide-react['"]\s*\)/.test(text),
    ).map((f) => f.path.replace(ROOT, 'src'));

    expect(offenders, `these bundle all ~2350 icons:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('imports icons individually so they stay a few kB', () => {
    // Any named import from the package root is fine for tree-shaking *only*
    // while nothing else pulls the namespace in; the test above is the guard
    // for that. Here we simply require the renderer that needed it to use the
    // per-icon paths.
    const shared = stripComments(readFileSync(join(ROOT, 'components/DynamicRenderer/components/shared.jsx'), 'utf8'));
    expect(shared).toMatch(/from 'lucide-react\/icons\//);
    expect(shared).not.toMatch(/from 'lucide-react';/);
  });

  it('does not give recharts a manual chunk', () => {
    // A manual chunk becomes a dependency of the entry, which is how 463 kB of
    // chart code ended up on the critical path of a page with no charts.
    const config = readFileSync(join(__dirname, '..', '..', 'vite.config.js'), 'utf8');
    const manualChunkBlock = config.slice(config.indexOf('manualChunks'));
    expect(manualChunkBlock).not.toMatch(/recharts/);
    expect(manualChunkBlock).not.toMatch(/d3-/);
  });

  it('keeps recharts out of anything the chat entry imports', () => {
    const rechartsFiles = FILES.filter(({ text }) => /from 'recharts'/.test(text))
      .map((f) => f.path.slice(ROOT.length + 1));

    // Chart code may live in the shared chart components (used only by the
    // pages that show charts) and in the lazy dynamic renderers. What it must
    // never do is reach the chat: `components/chat/*` and `pages/CommandChat`
    // are on the critical path.
    for (const relative of rechartsFiles) {
      expect(relative).not.toMatch(/components\/chat\//);
      expect(relative).not.toMatch(/pages\/CommandChat/);
      expect(relative).not.toMatch(/components\/(ui|Layout|Sidebar)\.jsx?$/);
    }
  });

  it('keeps the chat surface free of markdown renderers', () => {
    // react-markdown is its own 116 kB chunk; a chat bubble needs bold, code
    // and bullets, which the local renderer covers.
    for (const { path, text } of FILES) {
      const relative = path.slice(ROOT.length + 1);
      if (!/components\/chat\//.test(relative)) continue;
      expect(text, `${relative} should not pull react-markdown`).not.toMatch(/from 'react-markdown'/);
    }
  });
});
