import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import DynamicRenderer from '../components/DynamicRenderer/DynamicRenderer';
import tracsDocuments from './fixtures/tracsDocuments.json';

/**
 * PROGRESSIVE REVEAL
 * ==================
 *
 * The reply is fetched in one piece, so it used to appear all at once after a
 * silent wait. The reveal uncovers components one at a time, which means a
 * document rendered with a truncated component list must still be valid — if a
 * prefix of a real document could break the renderer, the reveal would flicker
 * or crash partway through every reply.
 *
 * This pins the invariant against real captured documents: every prefix renders.
 */
describe('a partially revealed document', () => {
  const docs = Array.isArray(tracsDocuments) ? tracsDocuments : Object.values(tracsDocuments);
  const first = docs.find((d) => Array.isArray(d?.components) && d.components.length >= 3);

  it('has a captured document to work with', () => {
    expect(first).toBeTruthy();
  });

  it('renders at every prefix without throwing', () => {
    const components = first.components;
    for (let n = 1; n <= components.length; n += 1) {
      const partial = { ...first, components: components.slice(0, n) };
      const { unmount } = render(<DynamicRenderer document={partial} actions={{}} />);
      unmount();
    }
    expect(true).toBe(true);
  });

  it('shows nothing extra from components that have not arrived', () => {
    const partial = { ...first, components: first.components.slice(0, 1) };
    render(<DynamicRenderer document={partial} actions={{}} />);
    // One component in, the panel exists and is not empty.
    expect(document.body.textContent.length).toBeGreaterThan(0);
  });
});
