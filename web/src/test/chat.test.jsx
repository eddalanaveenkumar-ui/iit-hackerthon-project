import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer, filterCommands } from '../components/chat/Composer';
import { Message, RichText, TypingBubble } from '../components/chat/index.jsx';

/**
 * THE CHAT SURFACE
 * ================
 *
 * These test the promises the UI makes about responsiveness, because those are
 * the ones that quietly regress:
 *
 *  - the composer stays usable while a reply is pending;
 *  - the send is a single Enter, and Shift+Enter is a newline;
 *  - the command palette is keyboard-driven and ranks by prefix;
 *  - a reply's markdown renders without any HTML being interpreted.
 */

const COMMANDS = [
  { cmd: '/start', label: 'Start a learning session', description: 'Pick a classroom' },
  { cmd: '/lesson', label: 'Interactive lesson', description: 'Build a lesson' },
  { cmd: '/classrooms', label: 'My classrooms', description: 'Open classrooms' },
  { cmd: '/progress', label: 'My progress', description: 'Mastery and gaps' },
];

describe('the composer', () => {
  it('stays writable while a reply is pending', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    function Shell() {
      const [v, setV] = useState('');
      return <Composer value={v} onChange={setV} onSubmit={onSubmit} busy />;
    }
    render(<Shell />);
    const box = screen.getByLabelText('Message');
    // The whole point: not disabled.
    expect(box).not.toBeDisabled();
    await user.type(box, 'next question');
    expect(box).toHaveValue('next question');
    expect(screen.getByText(/you can keep typing/i)).toBeTruthy();
  });

  it('sends on Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    function Shell() {
      const [v, setV] = useState('');
      return <Composer value={v} onChange={setV} onSubmit={(t) => { onSubmit(t); setV(''); }} />;
    }
    render(<Shell />);
    await user.type(screen.getByLabelText('Message'), 'explain recursion{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('explain recursion');
  });

  it('does NOT send on Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    function Shell() {
      const [v, setV] = useState('');
      return <Composer value={v} onChange={setV} onSubmit={onSubmit} />;
    }
    render(<Shell />);
    const box = screen.getByLabelText('Message');
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box).toHaveValue('line one\nline two');
  });

  it('never sends an empty message', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    function Shell() {
      const [v, setV] = useState('   ');
      return <Composer value={v} onChange={setV} onSubmit={onSubmit} />;
    }
    render(<Shell />);
    await user.type(screen.getByLabelText('Message'), '{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('offers Stop instead of Send when a reply is pending and nothing is typed', () => {
    const onStop = vi.fn();
    render(<Composer value="" onChange={vi.fn()} onSubmit={vi.fn()} onStop={onStop} busy commands={COMMANDS} />);
    expect(screen.getByLabelText('Stop waiting')).toBeTruthy();
  });

  it('lets the loaded commands be picked with the keyboard', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    function Shell() {
      const [v, setV] = useState('/');
      const [open, setOpen] = useState(true);
      return (
        <Composer
          value={v}
          onChange={setV}
          onSubmit={onSubmit}
          commands={COMMANDS}
          paletteOpen={open}
          onPaletteChange={setOpen}
        />
      );
    }
    render(<Shell />);
    const box = screen.getByLabelText('Message');
    await user.type(box, '{ArrowDown}{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Arrow down moves off the first item, so it is not `/start`.
    expect(onSubmit.mock.calls[0][0]).not.toBe('/start');
  });
});

describe('command ranking', () => {
  it('prefers a command prefix over a word in a description', () => {
    const ranked = filterCommands(COMMANDS, '/c');
    expect(ranked[0].cmd).toBe('/classrooms');
  });

  it('returns everything for a bare slash', () => {
    expect(filterCommands(COMMANDS, '/')).toHaveLength(COMMANDS.length);
  });

  it('finds a command by a word in its label', () => {
    const ranked = filterCommands(COMMANDS, 'mastery');
    expect(ranked.map((c) => c.cmd)).toContain('/progress');
  });

  it('returns nothing when nothing matches', () => {
    expect(filterCommands(COMMANDS, '/zzz')).toHaveLength(0);
  });
});

describe('a reply', () => {
  it('renders bold, inline code and bullets', () => {
    render(<RichText text={'Try **this**:\n- use `range(3)`\n- then print'} />);
    expect(screen.getByText('this').tagName).toBe('STRONG');
    expect(screen.getByText('range(3)').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('numbers an ordered list', () => {
    render(<RichText text={'1. first\n2. second'} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('first');
  });

  it('never interprets HTML in model output', () => {
    const { container } = render(<RichText text={'<img src=x onerror=alert(1)> and <script>bad()</script>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    // It is shown as text, which is the safe outcome.
    expect(container.textContent).toContain('<img src=x');
  });

  it('links only http(s) URLs', () => {
    const { container } = render(<RichText text={'see https://example.com/a and javascript:alert(1)'} />);
    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.com/a');
    expect(links[0].getAttribute('rel')).toContain('noopener');
  });

  it('shows the whole reply when motion is reduced', () => {
    render(<Message message={{ id: 'a', role: 'assistant', content: 'All of this is visible at once.' }} reduced />);
    expect(screen.getByText('All of this is visible at once.')).toBeTruthy();
  });

  it('reveals a streaming reply completely in the end', async () => {
    render(<Message message={{ id: 'b', role: 'assistant', content: 'Streaming text arrives.', streaming: true }} />);
    // The reveal is time-based; the full text must be on screen once it settles.
    await waitFor(() => expect(screen.getByText(/Streaming text arrives\./)).toBeTruthy());
  });

  it('renders user text verbatim, including angle brackets', () => {
    render(<Message message={{ id: 'c', role: 'user', content: '<b>not bold</b>' }} />);
    expect(screen.getByText('<b>not bold</b>')).toBeTruthy();
  });
});

describe('the typing indicator', () => {
  it('is announced to a screen reader rather than only animated', () => {
    render(<TypingBubble />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toMatch(/thinking/i);
  });
});

describe('renderer icons', () => {
  it('resolves every icon name the protocol allows', async () => {
    // shared.jsx now imports each icon by path instead of a namespace import,
    // so a typo in a path would silently render nothing. This walks the whole
    // registry the protocol exposes.
    const { Icon } = await import('../components/DynamicRenderer/components/shared');
    const names = [
      'book', 'bulb', 'target', 'code', 'chart', 'sparkles', 'check', 'flag', 'clock',
      'layers', 'sigma', 'flask', 'brain', 'terminal', 'list', 'alert', 'book-open',
      'book-open-check', 'play-circle', 'arrow-right', 'lightbulb', 'chevron-right',
      'graduation-cap', 'puzzle', 'rocket', 'cpu', 'function-square', 'database',
      'git-branch', 'repeat', 'shapes', 'pen-tool', 'trophy', 'bug', 'wrench', 'star',
      'info', 'zap', 'eye', 'search',
    ];
    for (const name of names) {
      const { container, unmount } = render(<Icon name={name} />);
      // Icons are forwardRef components; the svg lands on the first paint.
      await waitFor(() => {
        expect(container.querySelector('svg'), `icon "${name}" rendered nothing`).not.toBeNull();
      });
      unmount();
    }
  });

  it('renders nothing for an unknown name rather than crashing', async () => {
    const { Icon } = await import('../components/DynamicRenderer/components/shared');
    const { container } = render(<Icon name="not-a-real-icon" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
