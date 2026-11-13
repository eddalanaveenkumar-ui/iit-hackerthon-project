import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DynamicRenderer from '../components/DynamicRenderer/DynamicRenderer';
import { validateUI } from '../components/DynamicRenderer/utils/validateUI';

vi.mock('@monaco-editor/react', () => ({ default: ({ value }) => <textarea value={value} readOnly /> }));

/**
 * The documented layout shape — a `row` of boxes above a `grid` of cells —
 * must survive validation and render. It is the one component whose *data*
 * shape needed extending, so it gets a dedicated test.
 */

const doc = (components) => ({ version: '1.0', response_id: 'resp_layout', response_type: 'educational_tutorial', components });

const ROW_GRID = {
  id: 'layout-1',
  type: 'layout',
  direction: 'vertical',
  children: [
    { type: 'row', children: [{ type: 'box', content: 'Column 1' }, { type: 'box', content: 'Column 2' }] },
    {
      type: 'grid',
      columns: 3,
      children: [
        { type: 'text', content: 'A' },
        { type: 'text', content: 'B' },
        { type: 'text', content: 'C' },
        { type: 'text', content: 'D' },
        { type: 'text', content: 'E' },
        { type: 'text', content: 'F' },
      ],
    },
  ],
};

describe('layout groups — validation', () => {
  it('repairs a layout with bare cells instead of dropping it', () => {
    const result = validateUI(doc([ROW_GRID]));
    expect(result.ok).toBe(true);
    expect(result.dropped).toEqual([]);
    const layout = result.document.components[0];
    expect(layout.children.map((c) => c.type)).toEqual(['row', 'grid']);
  });

  it('gives every cell a unique id so React keys are stable', () => {
    const result = validateUI(doc([ROW_GRID]));
    const ids = [];
    const collect = (items) => (items || []).forEach((item) => {
      if (item.id) ids.push(item.id);
      collect(item.children);
    });
    collect(result.document.components);
    expect(ids.length).toBeGreaterThan(6);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('preserves an authored cell id rather than replacing it', () => {
    const authored = {
      id: 'layout-2',
      type: 'layout',
      children: [{ type: 'grid', columns: 2, children: [{ id: 'mine', type: 'text', content: 'kept' }] }],
    };
    const result = validateUI(doc([authored]));
    expect(result.document.components[0].children[0].children[0].id).toBe('mine');
  });

  it('rejects a group with no children', () => {
    const result = validateUI(doc([{ id: 'l', type: 'layout', children: [{ type: 'row', children: [] }] }]));
    expect(result.ok).toBe(false);
  });
});

describe('layout groups — rendering', () => {
  it('renders both boxes and every grid cell', async () => {
    const { container } = render(<DynamicRenderer document={doc([ROW_GRID])} actions={{ notify: vi.fn() }} />);
    await waitFor(() => expect(container.textContent).toContain('Column 1'));
    expect(screen.getByText('Column 2')).toBeInTheDocument();
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F']) {
      expect(screen.getByText(letter)).toBeInTheDocument();
    }
  });

  it('renders a grid cell that holds a real component', async () => {
    const mixed = {
      id: 'l3',
      type: 'layout',
      children: [
        {
          type: 'grid',
          columns: 2,
          children: [
            { type: 'box', content: 'A label' },
            { id: 'card-1', type: 'card', title: 'A card', body: 'Its body.' },
          ],
        },
      ],
    };
    render(<DynamicRenderer document={doc([mixed])} actions={{ notify: vi.fn() }} />);
    expect(await screen.findByText('A label')).toBeInTheDocument();
    expect(await screen.findByText('A card')).toBeInTheDocument();
  });

  it('never renders a cell as HTML', async () => {
    const hostile = {
      id: 'l4',
      type: 'layout',
      children: [{ type: 'row', children: [{ type: 'box', content: '<img src=x onerror=alert(1)>' }] }],
    };
    const { container } = render(<DynamicRenderer document={doc([hostile])} actions={{ notify: vi.fn() }} />);
    await waitFor(() => expect(container.textContent).toContain('onerror'));
    expect(container.querySelector('img')).toBeNull();
  });
});
