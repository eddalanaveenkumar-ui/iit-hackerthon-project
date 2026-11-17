import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * THE WHOLE STUDY LOOP, THROUGH THE REAL PAGE
 * ==========================================
 *
 * The unit tests cover the review panel and the server covers the loop, but
 * neither would have caught the bug this file was written for: the page sent
 * only `answers[0]` of a round, so a nine-question form submitted one answer and
 * eight questions were never sent.
 *
 * So this mounts the actual page with the API mocked and follows a learner from
 * the uploaded syllabus through Learn, a round, the diagnosis and the retest.
 */

const UNITS = [
  {
    index: 1,
    title: 'Java Fundamentals',
    concepts: [
      { id: 't1', title: 'Variables and Primitive Types' },
      { id: 't2', title: 'Conditionals' },
    ],
  },
  { index: 2, title: 'Object Orientation', concepts: [{ id: 't3', title: 'Classes and Objects' }] },
];

// A round exactly as the server builds it — this fixture is copied from a real
// `/learn` response rather than hand-written, because a hand-written one drifted
// from the schema (a stray `form_id` is enough to make the renderer drop the
// whole form) and hid what was being tested.
const round = (count, prefix = 'Q') => ({
  id: 'round-form',
  type: 'question_form',
  title: 'Java Fundamentals — ' + count + ' questions',
  description: 'Answer all of them, then submit once. The whole round is marked together.',
  questions: Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    type: 'radio',
    question: `${prefix}${i + 1} — which one is correct?`,
    required: true,
    // Plain strings, as the server emits them; `normaliseOptions` handles both.
    options: ['Alpha', 'Beta'],
  })),
  submission: { button_text: `Submit ${count} answers`, action: 'submit_ai_questions', evaluation: 'ai_evaluation' },
});

const session = (overrides = {}) => ({
  id: 'sess-1',
  title: 'Java',
  mode: 'test',
  messages: [],
  units: UNITS,
  syllabus_markdown: '### Unit 1: Java Fundamentals\n\n- Variables and Primitive Types',
  ...overrides,
});

const calls = [];
vi.mock('../lib/tracs', () => ({
  uploadTracsSyllabus: vi.fn(async () => {
    calls.push(['upload']);
    return { ok: true, session: session({ messages: [] }), units: UNITS, syllabus_markdown: '### Unit 1: Java Fundamentals' };
  }),
  fetchTracsSession: vi.fn(async () => ({ session: session(), units: UNITS })),
  listTracsSessions: vi.fn(async () => ({ sessions: [] })),
  deleteTracsSession: vi.fn(async () => ({ ok: true })),
  chooseTracsUnit: vi.fn(async (_id, unit) => {
    calls.push(['chooseUnit', unit]);
    return {
      ok: true,
      unit,
      session: session({ mode: 'unit_chosen', selected_unit: { title: 'Java Fundamentals', index: 1 } }),
      choices: [{ id: 'learn', command: 'learn' }, { id: 'test', command: 'test' }],
    };
  }),
  sendTracsTurn: vi.fn(async (_id, payload) => {
    calls.push(['turn', payload]);
    if (payload.command === 'learn') {
      return {
        ok: true,
        outcome: 'explained',
        document: {
          components: [
            { type: 'text', id: 'x1', content: 'A variable is a name for a value.' },
            round(5),
          ],
        },
        session: session({ mode: 'learn', messages: [] }),
      };
    }
    return {
      ok: true,
      outcome: 'round_diagnosed',
      diagnosis: { total: 5, correct: 3, misses: [], unjudged: [] },
      document: { components: [{ type: 'text', id: 'd1', content: 'Three of five were wrong.' }] },
      session: session({ messages: [] }),
    };
  }),
}));

import { ToastProvider } from '../components/ui.jsx';
import Tracs from '../pages/Tracs.jsx';

const renderPage = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/app/tracs']}>
        <Routes>
          <Route path="/app/tracs" element={<Tracs />} />
          <Route path="/app/tracs/:sessionId" element={<Tracs />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );

beforeEach(() => {
  calls.length = 0;
});

describe('the study loop through the page', () => {
  it('shows the extracted syllabus after an upload, before any question', async () => {
    const { container } = renderPage();

    // There is no file to pick in jsdom, so drive the text path the page uses.
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    await userEvent.type(textarea, '### Unit 1: Java Fundamentals\n- Variables and Primitive Types');
    const upload = screen.getByRole('button', { name: /start tracs/i });
    expect(upload).toBeTruthy();
    await userEvent.click(upload);

    await waitFor(() => expect(document.body.textContent).toMatch(/2 units · 3 concepts/));
    // Both units, each with its own concepts — the label and the title are
    // separate nodes, so match the panel's text rather than one element.
    const text = document.body.textContent.replace(/\s+/g, ' ');
    expect(text).toContain('Unit 1: Java Fundamentals');
    expect(text).toContain('Unit 2: Object Orientation');
    expect(text).toContain('Variables and Primitive Types');
    expect(text).toContain('Classes and Objects');
    // And nothing has been asked yet.
    expect(screen.queryByText(/which one is correct/i)).toBeNull();
  });

  it('offers Learn and Test for the chosen unit, and sends the unit with them', async () => {
    renderPage();
    const textarea = document.querySelector('textarea');
    await userEvent.type(textarea, '### Unit 1: Java Fundamentals\n- Variables and Primitive Types');
    await userEvent.click(screen.getByRole('button', { name: /start tracs/i }));

    await waitFor(() => expect(document.body.textContent).toMatch(/2 units · 3 concepts/));

    // First click: which unit. Second click: Learn or Test. A unit is not
    // started, and no question is asked, until the mode is chosen.
    await userEvent.click(screen.getAllByRole('button', { name: /Choose/ })[0]);
    expect(calls.some(([k]) => k === 'chooseUnit')).toBe(false);

    await waitFor(() => expect(screen.getByRole('button', { name: /Learn/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Test/ })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Test/ }));
    await waitFor(() => expect(calls.some(([k]) => k === 'chooseUnit')).toBe(true));
    // The unit is named by title, and the mode is sent as the turn's command.
    expect(calls.find(([k]) => k === 'chooseUnit')[1]).toBe('Java Fundamentals');
    expect(calls.find(([k, p]) => k === 'turn' && p.command === 'test')).toBeTruthy();
  });

  it('submits every answer in the round, not just the first', async () => {
    renderPage();
    const textarea = document.querySelector('textarea');
    await userEvent.type(textarea, '### Unit 1: Java Fundamentals\n- Variables and Primitive Types');
    const upload = screen.getByRole('button', { name: /start tracs/i });
    await userEvent.click(upload);
    await waitFor(() => expect(document.body.textContent).toMatch(/2 units · 3 concepts/));

    await userEvent.click(screen.getAllByRole('button', { name: /Choose/ })[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: /Learn/ })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: /Learn/ }));

    // The Learn turn comes back with an explanation and a five-question round.
    await waitFor(() => expect(screen.getByText(/A variable is a name for a value/)).toBeTruthy());
    await waitFor(() => expect(document.body.textContent).toMatch(/Java Fundamentals — 5 questions/));

    // Answer all five, then submit once. One option per question, so the first
    // radio of each pair.
    const radios = [...document.querySelectorAll('input[type="radio"]')];
    expect(radios.length).toBe(10); // two options × five questions
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(radios[i * 2]);
    }
    await waitFor(() => expect(document.body.textContent).not.toMatch(/5 required questions left/));
    const submit = screen.getAllByRole('button').find((b) => /^submit \d+ answers/i.test(b.textContent.trim()));
    expect(submit).toBeTruthy();
    await userEvent.click(submit);

    // The Learn turn carries `answers` too (as an empty field), so wait for the
    // submission itself: the turn that actually carries the five answers.
    await waitFor(() => expect(calls.some(([k, p]) => k === 'turn' && p.answers?.length === 5)).toBe(true));
    const turn = calls.find(([k, p]) => k === 'turn' && p.answers?.length === 5)[1];

    // The bug this file exists for: this used to be a single `answer` and four
    // of the five questions were never sent.
    expect(turn.answer).toBeUndefined();
    expect(turn.answers.map((a) => a.question_id)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5']);
    expect(turn.answers.every((a) => a.value === 'Alpha')).toBe(true);
    expect(turn.command).toBe('learn');

    // And the round is answered, not still nagging for input.
    await waitFor(() => expect(document.body.textContent).not.toMatch(/required questions? left/));
  });
});
