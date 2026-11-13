import { describe, expect, it } from 'vitest';

/**
 * MODULE-LOAD SMOKE TEST
 * ======================
 *
 * Two bugs found while testing were not logic errors — they were modules that
 * could not be *loaded*:
 *
 *   - `CodeRenderer.jsx` ended with `export const CODE_IS_UNSAVED = dirty;`,
 *     referencing a local from a component body. Every lesson with a code editor
 *     hit the error boundary instead of rendering.
 *   - `QuestionFormRenderer.jsx` read a `const` before its declaration.
 *
 * Neither is caught by a type-check-free build (Vite happily emits the module)
 * and neither appears until that component is on screen. Importing every module
 * in the registry is the cheapest possible guard against the whole class.
 */

const MODULES = [
  '../components/DynamicRenderer/DynamicRenderer',
  '../components/DynamicRenderer/ComponentRegistry',
  '../components/DynamicRenderer/RendererErrorBoundary',
  '../components/DynamicRenderer/DynamicContext',
  '../components/DynamicRenderer/schemas/uiSchema',
  '../components/DynamicRenderer/utils/validateUI',
  '../components/DynamicRenderer/utils/sanitizeContent',
  '../components/DynamicRenderer/components/shared',
  ...['Text', 'Layout', 'Card', 'Media', 'Data', 'Input', 'Navigation', 'Quiz', 'Learning', 'Code', 'Math', 'Diagram', 'Action', 'Progress', 'Timeline', 'Simulation', 'Execution', 'QuestionForm'].map(
    (name) => `../components/DynamicRenderer/components/${name}Renderer`,
  ),
  '../components/Markdown',
  '../lib/dynamicUi',
  '../lib/messageText',
];

describe('every renderer module loads', () => {
  for (const path of MODULES) {
    it(`imports ${path.split('/').pop()}`, async () => {
      const module = await import(/* @vite-ignore */ path);
      expect(module).toBeTruthy();
    });
  }
});

describe('the registry covers the protocol', () => {
  it('every component type in the schema has a renderer', async () => {
    const { COMPONENT_TYPES } = await import('../components/DynamicRenderer/schemas/uiSchema');
    const { getRenderer } = await import('../components/DynamicRenderer/ComponentRegistry');
    const missing = COMPONENT_TYPES.filter((type) => !getRenderer(type));
    expect(missing).toEqual([]);
    expect(COMPONENT_TYPES).toHaveLength(25);
  });

  it('returns nothing for an unknown type rather than a broken renderer', async () => {
    const { getRenderer } = await import('../components/DynamicRenderer/ComponentRegistry');
    expect(getRenderer('not_a_type')).toBeFalsy();
    expect(getRenderer(undefined)).toBeFalsy();
  });
});
