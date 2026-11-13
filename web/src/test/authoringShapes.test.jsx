import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DynamicRenderer from '../components/DynamicRenderer/DynamicRenderer';
import { validateUI } from '../components/DynamicRenderer/utils/validateUI';

vi.mock('@monaco-editor/react', () => ({ default: ({ value }) => <textarea readOnly value={value} /> }));

/**
 * THE AUTHORING SHAPES
 * ====================
 *
 * The sketches a lesson is written from use a handful of shapes the engine did
 * not previously accept: a `card_group`, a `media` block whose items each
 * declare a `media_type`, a `data` block keyed by `x_key` / `y_key`, and a
 * `navigation` block made of a carousel and a popover. Each one is tested for
 * both halves of its contract — it parses, and it draws.
 */

const doc = (components) => ({ version: '1.0', response_id: 'resp_shapes', response_type: 'educational_tutorial', components });
const actions = { notify: vi.fn(), submitQuiz: vi.fn(), runCode: vi.fn(), markComplete: vi.fn(), navigate: vi.fn() };

describe('card_group', () => {
  const cards = {
    id: 'modules',
    type: 'card_group',
    layout: 'grid',
    columns: 2,
    items: [
      { id: 'b1', title: 'Python Basics', icon: 'book-open', badge: 'Beginner', description: 'Variables, loops and functions' },
      { id: 'b2', title: 'Advanced Python', icon: 'brain', badge: 'Advanced', description: 'Decorators and generators' },
    ],
  };

  it('parses and keeps every item', () => {
    const result = validateUI(doc([cards]));
    expect(result.ok).toBe(true);
    expect(result.document.components[0].items).toHaveLength(2);
  });

  it('renders titles, badges and descriptions', async () => {
    render(<DynamicRenderer document={doc([cards])} actions={actions} />);
    expect(await screen.findByText('Python Basics')).toBeInTheDocument();
    expect(screen.getByText('Advanced Python')).toBeInTheDocument();
    expect(screen.getByText('Beginner')).toBeInTheDocument();
    expect(screen.getByText('Variables, loops and functions')).toBeInTheDocument();
  });

  it('renders an empty group without crashing', async () => {
    render(<DynamicRenderer document={doc([{ ...cards, items: [] }])} actions={actions} />);
    await waitFor(() => expect(document.body.textContent.length).toBeGreaterThan(0));
  });
});

describe('media with items[]', () => {
  const media = {
    id: 'm1',
    type: 'media',
    items: [
      { id: 'i1', media_type: 'image', src: 'https://example.com/chart.png', alt: 'A chart', aspect_ratio: '16:9' },
      { id: 'i2', media_type: 'video', src: 'https://example.com/clip.mp4', controls: true },
      { id: 'i3', media_type: 'icon', name: 'play-circle' },
    ],
  };

  it('renders an image, a video and an icon from one block', async () => {
    const { container } = render(<DynamicRenderer document={doc([media])} actions={actions} />);
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    expect(video.getAttribute('src')).toBe('https://example.com/clip.mp4');
    expect(video).toHaveAttribute('controls');
  });

  it('strips an unsafe source but keeps the block\'s other items', async () => {
    const mixed = {
      ...media,
      items: [
        { id: 'bad', media_type: 'image', src: 'javascript:alert(1)' },
        { id: 'good', media_type: 'image', src: 'https://example.com/ok.png', alt: 'Safe' },
      ],
    };
    const { container } = render(<DynamicRenderer document={doc([mixed])} actions={actions} />);
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    // the hostile source never reaches an attribute
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('drops the block entirely when every source is unsafe', () => {
    const hostile = { ...media, items: [{ id: 'x', media_type: 'image', src: 'javascript:alert(1)' }] };
    const result = validateUI(doc([hostile]));
    // Nothing usable survives, so the validator refuses the document rather
    // than rendering an empty shell.
    expect(result.ok).toBe(false);
    expect(result.dropped.some((d) => /unsafe media/i.test(d.message))).toBe(true);
  });

  it('still renders the original single-media shape', async () => {
    const single = { id: 's1', type: 'media', media_kind: 'image', src: 'https://example.com/one.png', alt: 'One' };
    const { container } = render(<DynamicRenderer document={doc([single])} actions={actions} />);
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
  });
});

describe('data with x_key / y_key', () => {
  const data = {
    id: 'd1',
    type: 'data',
    components: [
      {
        id: 'ch1',
        type: 'chart',
        chart_type: 'bar',
        title: 'Monthly users',
        x_key: 'month',
        y_key: 'users',
        data: [{ month: 'Jan', users: 12 }, { month: 'Feb', users: 19 }],
      },
      {
        id: 'tb1',
        type: 'table',
        columns: ['Month', 'Users'],
        rows: [['Jan', 12], ['Feb', 19]],
      },
    ],
  };

  it('renders the chart title and the table cells', async () => {
    render(<DynamicRenderer document={doc([data])} actions={actions} />);
    expect(await screen.findByText('Monthly users')).toBeInTheDocument();
    expect(await screen.findByText('Feb')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('drops non-numeric y values rather than plotting them as zero', () => {
    const result = validateUI(doc([{ ...data, components: [data.components[0]] }]));
    expect(result.ok).toBe(true);
  });

  it('drops an empty chart child but keeps a usable table beside it', () => {
    const emptyChart = { ...data, components: [{ ...data.components[0], data: [] }, data.components[1]] };
    const result = validateUI(doc([emptyChart]));
    expect(result.ok).toBe(true);
    expect(result.document.components[0].components).toHaveLength(1);
    expect(result.document.components[0].components[0].type).toBe('table');
  });
});

describe('navigation with carousel and popover', () => {
  const navigation = {
    id: 'n1',
    type: 'navigation',
    components: [
      { id: 'c1', type: 'carousel', items: [{ id: 's1', title: 'Variables', lesson: 'Lesson 1' }, { id: 's2', title: 'Loops', lesson: 'Lesson 3' }] },
      { id: 'p1', type: 'popover', trigger: 'More lessons', items: [{ id: 'i1', label: 'Functions' }] },
    ],
  };

  it('advances the carousel locally', async () => {
    const user = userEvent.setup();
    render(<DynamicRenderer document={doc([navigation])} actions={actions} />);
    expect(await screen.findByText('Variables')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Next slide'));
    expect(await screen.findByText('Loops')).toBeInTheDocument();
    expect(actions.navigate).not.toHaveBeenCalled();
  });

  it('opens the popover and never navigates', async () => {
    const user = userEvent.setup();
    render(<DynamicRenderer document={doc([navigation])} actions={actions} />);
    const trigger = await screen.findByText('More lessons');
    expect(screen.queryByText('Functions')).toBeNull();
    await user.click(trigger);
    expect(await screen.findByText('Functions')).toBeInTheDocument();
    expect(actions.navigate).not.toHaveBeenCalled();
  });
});
