import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * THE STUDY LOOP, THROUGH THE REAL PAGE
 * =====================================
 *
 * Two flows, and this file exists because testing the server and the panel
 * separately never caught what the page in between was doing:
 *
 *   learn  one concept explained, then two buttons — next concept, or test it
 *   test   one question at a time, nothing revealed until the summary
 *
 * A button has to carry the concept it names. "Learn next topic: Loops" that
 * sends no topic id is a button that explains whatever the server picks, which
 * is how the whole feature quietly stops working while every unit test passes.
 */

const UNITS = [
  {
    index: 1,
    title: 'Python Basics',
    concepts: [
      { id: 't1', title: 'Variables' },
      { id: 't2', title: 'Loops' },
    ],
  },
  { index: 2, title: 'Object Orientation', concepts: [{ id: 't3', title: 'Classes' }] },
];

const oneQuestion = (n, concept = 'Variables') => ({
  id: `form_q${n}`,
  type: 'question_form',
  title: concept,
  description: `Question ${n}?`,
  questions: [
    {
      id: `Q${n}`,
      type: 'radio',
      question: `Question ${n} about ${concept}?`,
      required: true,
      options: ['Alpha', 'Beta'],
    },
  ],
  submission: { button_text: 'Submit answer', action: 'submit_ai_questions', evaluation: 'ai_evaluation' },
});

const explanation = (concept, nextTitle) => ({
  version: '1.0',
  response_id: `r_${concept.id}`,
  response_type: 'educational_tutorial',
  components: [
    { id: 'x1', type: 'text', content: `**Python Basics** → **${concept.title}**` },
    { id: 'x2', type: 'text', content: `${concept.title} is a name bound to a value.` },
    {
      id: `after_${concept.id}`,
      type: 'actions',
      title: 'Where next',
      actions: [
        { id: 'test_this_topic', label: `Test this topic: ${concept.title}`, action: 'continue_lesson', command: 'test', topic_id: concept.id, tone: 'brand' },
        ...(nextTitle
          ? [{ id: 'learn_next_topic', label: `Learn next topic: ${nextTitle.title}`, action: 'continue_lesson', command: 'learn', topic_id: nextTitle.id }]
          : []),
      ],
    },
  ],
});

const session = (overrides = {}) => ({
  id: 'sess-1',
  title: 'Python',
  mode: 'test',
  messages: [],
  units: UNITS,
  ...overrides,
});

const calls = [];
vi.mock('../lib/tracs', () => ({
  uploadTracsSyllabus: vi.fn(async () => ({ ok: true, session: session(), units: UNITS })),
  fetchTracsSession: vi.fn(async () => ({ session: session(), units: UNITS })),
  listTracsSessions: vi.fn(async () => ({ sessions: [] })),
  deleteTracsSession: vi.fn(async () => ({ ok: true })),
  chooseTracsUnit: vi.fn(async (_id, unit) => {
    calls.push(['chooseUnit', unit]);
    return { ok: true, session: session({ mode: 'unit_chosen', selected_unit: { title: 'Python Basics', index: 1 } }) };
  }),
  sendTracsTurn: vi.fn(async (_id, payload) => {
    calls.push(['turn', payload]);
    if (payload.command === 'learn') {
      const concept = payload.topic_id === 't2' ? UNITS[0].concepts[1] : UNITS[0].concepts[0];
      return { ok: true, outcome: 'explained', document: explanation(concept, concept.id === 't1' ? UNITS[0].concepts[1] : null), session: session() };
    }
    // The adaptive test: one question per turn, no verdict anywhere.
    const n = (calls.filter(([k, p]) => k === 'turn' && p.command === 'test').length);
    return { ok: true, outcome: 'question', document: { version: '1.0', response_id: 'q', response_type: 'question_form', components: [oneQuestion(n)] }, session: session() };
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

/** Upload and pick the first unit, leaving the page on the Learn/Test choice. */
async function openUnit() {
  renderPage();
  await userEvent.type(document.querySelector('textarea'), '### Unit 1: Python Basics\n- Variables');
  await userEvent.click(screen.getByRole('button', { name: /start tracs/i }));
  await waitFor(() => expect(document.body.textContent).toMatch(/2 units/));
  await userEvent.click(screen.getAllByRole('button', { name: /Choose/ })[0]);
  await waitFor(() => expect(screen.getByRole('button', { name: /Learn/ })).toBeTruthy());
}

beforeEach(() => {
  calls.length = 0;
});

describe('the study loop through the page', () => {
  it('shows the extracted syllabus before any question', async () => {
    renderPage();
    await userEvent.type(document.querySelector('textarea'), '### Unit 1: Python Basics\n- Variables');
    await userEvent.click(screen.getByRole('button', { name: /start tracs/i }));

    await waitFor(() => expect(document.body.textContent).toMatch(/2 units/));
    const text = document.body.textContent.replace(/\s+/g, ' ');
    expect(text).toContain('Unit 1: Python Basics');
    expect(text).toContain('Unit 2: Object Orientation');
    expect(text).not.toMatch(/Question \d+ about/);
  });

  it('explains one concept and offers exactly two ways on', async () => {
    await openUnit();
    await userEvent.click(screen.getByRole('button', { name: /Learn/ }));

    await waitFor(() => expect(document.body.textContent).toMatch(/Variables is a name bound to a value/));

    // Two actions, and neither is a question: an explanation is not a quiz.
    await waitFor(() => expect(screen.getByRole('button', { name: /Test this topic: Variables/ })).toBeTruthy());
    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
    expect(labels).toContain('Test this topic: Variables');
    expect(labels).toContain('Learn next topic: Loops');
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });

  it('sends the concept a button names, not just its command', async () => {
    await openUnit();
    await userEvent.click(screen.getByRole('button', { name: /Learn/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Learn next topic: Loops/ })).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: /Learn next topic: Loops/ }));

    await waitFor(() => expect(calls.some(([k, p]) => k === 'turn' && p.topic_id === 't2')).toBe(true));
    const learn = calls.filter(([k, p]) => k === 'turn' && p.topic_id === 't2').pop()[1];
    // The bug this guards: a button with no topic id explains whatever the
    // server would have picked, so "next topic" shows the same topic again.
    expect(learn.command).toBe('learn');
    expect(learn.topic_id).toBe('t2');
    await waitFor(() => expect(document.body.textContent).toMatch(/Loops is a name bound to a value/));
  });

  it('asks the test one question at a time and reveals no verdict', async () => {
    await openUnit();
    await userEvent.click(screen.getByRole('button', { name: /Test/ }));

    await waitFor(() => expect(document.body.textContent).toMatch(/Question 1 about/));
    // Exactly one question on screen.
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(2);

    fireEvent.click(document.querySelectorAll('input[type="radio"]')[0]);
    fireEvent.click([...document.querySelectorAll('button')].find((b) => /submit/i.test(b.textContent)));

    // The next question arrives, and nothing has been said about the last one.
    await waitFor(() => expect(document.body.textContent).toMatch(/Question 2 about/));
    const text = document.body.textContent;
    expect(text).not.toMatch(/correct|incorrect|misconception|knowledge gap|practical difficulty/i);
    expect(text).not.toMatch(/Question 1 about/);
  });

  it('keeps "Test this topic" pointed at the concept being explained', async () => {
    await openUnit();
    await userEvent.click(screen.getByRole('button', { name: /Learn/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Test this topic: Variables/ })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: /Test this topic: Variables/ }));

    await waitFor(() => expect(calls.some(([k, p]) => k === 'turn' && p.command === 'test')).toBe(true));
    const turn = calls.find(([k, p]) => k === 'turn' && p.command === 'test')[1];
    expect(turn.topic_id).toBe('t1');
    await waitFor(() => expect(document.body.textContent).toMatch(/Question 1 about/));
  });
});
