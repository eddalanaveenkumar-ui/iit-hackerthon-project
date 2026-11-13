import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Markdown from '../components/Markdown';

/**
 * INLINE CODE MUST STAY INLINE
 * ============================
 *
 * react-markdown v10 removed the `inline` flag that the code renderer used to
 * branch on. Every inline code span therefore fell through to the block branch
 * and rendered a `<pre>` — so "Type `/test` for a question" broke across three
 * lines with the commands on their own rows, which is exactly how it looked in
 * the tracs welcome message.
 *
 * These tests pin the distinction, because the symptom is cosmetic enough to
 * slip through review and the cause is a library detail nobody would guess.
 */

const renderMd = (text) => render(<Markdown text={text} />);

describe('inline code', () => {
  it('does not become a block', async () => {
    const { container } = renderMd('Type `/test` for a question, or `/learn` for an explanation.');
    await waitFor(() => expect(container.textContent).toContain('for a question'));
    // No <pre> anywhere: nothing here is a fenced block.
    expect(container.querySelectorAll('pre')).toHaveLength(0);
    // The spans are real inline <code> elements.
    const codes = container.querySelectorAll('code');
    expect(codes).toHaveLength(2);
    expect(codes[0].textContent).toBe('/test');
    expect(codes[1].textContent).toBe('/learn');
  });

  it('keeps the sentence in one paragraph', async () => {
    const { container } = renderMd('Use `x = 5` to assign a value.');
    await waitFor(() => expect(container.textContent).toContain('to assign a value'));
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelector('p').textContent).toBe('Use x = 5 to assign a value.');
  });
});

describe('fenced code', () => {
  it('renders a block when a language is named', async () => {
    const { container } = renderMd('```python\nx = 5\n```');
    await waitFor(() => expect(container.querySelector('pre')).toBeTruthy());
    expect(container.querySelector('pre').textContent).toContain('x = 5');
  });

  it('renders a block for a multi-line fence with no language', async () => {
    const { container } = renderMd('```\nline one\nline two\n```');
    await waitFor(() => expect(container.querySelector('pre')).toBeTruthy());
    expect(container.querySelector('pre').textContent).toContain('line two');
  });
});

describe('the tracs welcome message', () => {
  it('renders both commands inline, not as blocks', async () => {
    // The exact shape the page emits.
    const text = 'Data Structures is loaded with 9 topics.\n\nType `/test` for a question, or `/learn` for an explanation followed by checks. Nothing else is available here.';
    const { container } = renderMd(text);
    await waitFor(() => expect(container.textContent).toContain('Nothing else is available here'));
    expect(container.querySelectorAll('pre')).toHaveLength(0);
  });
});
