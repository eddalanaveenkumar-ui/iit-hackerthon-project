import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SyllabusReview from '../components/tracs/SyllabusReview';

/**
 * THE EXTRACTED SYLLABUS, BEFORE THE CHAT
 * =======================================
 *
 * After uploading, the learner must see the syllabus as units of concepts — in
 * the shape the brief asked for — and choose a unit before any question is
 * asked. The chat then offers Learn or Test for that unit.
 */

const UNITS = [
  {
    index: 1,
    title: 'Java Fundamentals',
    concepts: [
      { id: 't1', title: 'Variables and Primitive Types' },
      { id: 't2', title: 'Operators and Expressions' },
      { id: 't3', title: 'Conditionals' },
    ],
  },
  {
    index: 2,
    title: 'Object Orientation',
    concepts: [
      { id: 't4', title: 'Classes and Objects' },
      { id: 't5', title: 'Inheritance' },
    ],
  },
];

describe('the extracted syllabus', () => {
  it('lists units with their concepts', () => {
    render(<SyllabusReview units={UNITS} onChoose={vi.fn()} />);
    expect(screen.getByText('Unit 1: Java Fundamentals')).toBeTruthy();
    expect(screen.getByText('Unit 2: Object Orientation')).toBeTruthy();
    // The concepts belong to their unit, not to one flat list.
    const first = screen.getByText('Unit 1: Java Fundamentals').closest('div');
    expect(within(first).getByText('Conditionals')).toBeTruthy();
    expect(screen.getByText('Inheritance')).toBeTruthy();
  });

  it('says how much was found', () => {
    render(<SyllabusReview units={UNITS} onChoose={vi.fn()} />);
    expect(screen.getByText(/2 units · 5 concepts/)).toBeTruthy();
  });

  it('puts the unit’s concepts under it, in order', () => {
    const { container } = render(<SyllabusReview units={UNITS} onChoose={vi.fn()} />);
    const items = [...container.querySelectorAll('li')].map((li) => li.textContent.trim());
    expect(items).toEqual([
      'Variables and Primitive Types',
      'Operators and Expressions',
      'Conditionals',
      'Classes and Objects',
      'Inheritance',
    ]);
  });

  it('asks which unit before offering Learn or Test', async () => {
    const onChoose = vi.fn();
    render(<SyllabusReview units={UNITS} onChoose={onChoose} />);
    // No mode buttons until a unit is chosen: picking the unit and the mode in
    // one click would choose the mode for the learner.
    expect(screen.queryByRole('button', { name: /^Learn$/ })).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: /Choose/ })[1]);
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ title: 'Object Orientation' }), null);
  });

  it('offers Learn and Test once a unit is chosen', async () => {
    const onChoose = vi.fn();
    render(<SyllabusReview units={UNITS} onChoose={onChoose} chosen={UNITS[0]} />);
    const learn = screen.getByRole('button', { name: /Learn/ });
    const test = screen.getByRole('button', { name: /Test/ });
    expect(learn).toBeTruthy();
    expect(test).toBeTruthy();
    await userEvent.click(learn);
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ title: 'Java Fundamentals' }), 'learn');
    await userEvent.click(test);
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ title: 'Java Fundamentals' }), 'test');
  });

  it('explains what the two modes do', () => {
    render(<SyllabusReview units={UNITS} onChoose={vi.fn()} chosen={UNITS[0]} />);
    expect(screen.getByText(/skips the explanation/i)).toBeTruthy();
  });

  it('renders nothing when there is nothing to show', () => {
    const { container } = render(<SyllabusReview units={[]} onChoose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
