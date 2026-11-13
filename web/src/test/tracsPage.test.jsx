import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Tracs from '../pages/Tracs';

/**
 * THE TRACS SURFACE
 * =================
 *
 * The brief for this page is narrow and absolute: it accepts a syllabus, and
 * then it offers exactly two commands. These tests hold that line at the UI
 * layer, and check that an answer typed into a one-question form travels back
 * to the server as a `/test` turn rather than being swallowed.
 */

vi.mock('@monaco-editor/react', () => ({ default: ({ value }) => <textarea readOnly value={value} /> }));

const apiMock = vi.fn();
vi.mock('../lib/api', () => ({
  api: (...args) => apiMock(...args),
  apiUrl: (path) => path,
  getToken: () => null,
}));

const toast = { info: vi.fn(), error: vi.fn(), success: vi.fn() };
vi.mock('../components/ui', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useToast: () => toast };
});

const SESSION = {
  id: 'sess1',
  title: 'Data Structures',
  stats: { answered: 0, correct: 0, topics: 2 },
  topics: [
    { id: 't1', title: 'Lists and tuples', mastery: 0, attempts: 0, correct: 0, mastery_label: 'Not started' },
    { id: 't2', title: 'Dictionaries', mastery: 0, attempts: 0, correct: 0, mastery_label: 'Not started' },
  ],
};

const oneQuestionDoc = (question) => ({
  version: '1.0',
  response_id: 'r1',
  response_type: 'question_form',
  components: [
    {
      id: 'form_1',
      type: 'question_form',
      title: 'Lists and tuples — question 1 of 2',
      questions: [{ id: 'q_1', type: 'radio', question: 'Which is immutable?', options: ['A list', 'A tuple'], required: true }],
      submission: { button_text: 'Submit answer', action: 'submit_ai_questions' },
    },
  ],
});

function renderPage(path = '/app/tracs/sess1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/tracs" element={<Tracs />} />
        <Route path="/app/tracs/:sessionId" element={<Tracs />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('tracs — the upload surface', () => {
  it('offers a file, a paste box and the two commands', async () => {
    apiMock.mockResolvedValue({ sessions: [] });
    renderPage('/app/tracs');

    expect(await screen.findByLabelText(/syllabus file/i)).toBeInTheDocument();
    expect(screen.getByText(/PDF, DOCX, PPTX, TXT or Markdown/i)).toBeInTheDocument();
    // Both commands are named before the learner uploads, so the contract is
    // clear from the first screen.
    expect(screen.getAllByText('/test').length).toBeGreaterThan(0);
    expect(screen.getAllByText('/learn').length).toBeGreaterThan(0);
  });

  it('refuses an empty upload with a readable message', async () => {
    apiMock.mockResolvedValue({ sessions: [] });
    const user = userEvent.setup();
    renderPage('/app/tracs');

    await user.click(await screen.findByRole('button', { name: /start tracs/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/choose a syllabus file or paste its text/i);
  });
});

describe('tracs — exactly two commands', () => {
  beforeEach(() => {
    apiMock.mockImplementation((path, options) => {
      if (path === '/tracs/sess1' && (!options || options.method === undefined)) {
        return Promise.resolve({ session: SESSION, open_question: null });
      }
      if (path === '/tracs/sess1/turn') {
        return Promise.resolve({ command: 'test', outcome: 'question', document: oneQuestionDoc(), session: SESSION });
      }
      return Promise.resolve({});
    });
  });

  it('shows only /test and /learn as commands', async () => {
    renderPage();
    expect((await screen.findAllByText('Data Structures'))[0]).toBeInTheDocument();

    const test_ = screen.getAllByText('/test');
    const learn = screen.getAllByText('/learn');
    expect(test_.length).toBeGreaterThan(0);
    expect(learn.length).toBeGreaterThan(0);
    // A third command is not offered anywhere on the surface.
    expect(screen.queryByText('/help')).toBeNull();
    expect(screen.queryByText('/quiz')).toBeNull();
  });

  it('refuses any other command without calling the server', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText('Data Structures');

    const box = screen.getByLabelText(/^command$/i);
    await user.type(box, '/help');
    await user.click(screen.getByLabelText(/send command/i));

    expect(await screen.findByText(/Only \/test and \/learn are available here/i)).toBeInTheDocument();
    // The turn endpoint was never reached.
    expect(apiMock.mock.calls.filter(([p]) => String(p).includes('/turn'))).toHaveLength(0);
  });

  it('sends /test as a turn when the pill is pressed', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText('Data Structures');

    const pills = screen.getAllByRole('button', { name: /\/test/i });
    await user.click(pills[0]);

    await waitFor(() => {
      const turn = apiMock.mock.calls.find(([p]) => String(p).endsWith('/turn'));
      expect(turn).toBeTruthy();
      expect(turn[1].body.command).toBe('test');
    });
  });

  it('renders the returned question form', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText('Data Structures');

    await user.click(screen.getAllByRole('button', { name: /\/test/i })[0]);
    expect(await screen.findByText(/Which is immutable\?/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit answer/i })).toBeInTheDocument();
  });

  it('sends a typed /learn as a learn turn', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText('Data Structures');

    const box = screen.getByLabelText(/^command$/i);
    await user.type(box, '/learn');
    await user.click(screen.getByLabelText(/send command/i));

    await waitFor(() => {
      const turn = apiMock.mock.calls.find(([p]) => String(p).endsWith('/turn'));
      expect(turn).toBeTruthy();
      expect(turn[1].body.command).toBe('learn');
    });
  });
});

describe('tracs — answering a question', () => {
  it('submits the chosen answer as a /test turn', async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path, options) => {
      if (path === '/tracs/sess1' && !options) return Promise.resolve({ session: SESSION, open_question: null });
      if (path === '/tracs/sess1/turn' && options?.body?.answer === undefined) {
        return Promise.resolve({ command: 'test', outcome: 'question', document: oneQuestionDoc(), session: SESSION });
      }
      if (path === '/tracs/sess1/turn') {
        return Promise.resolve({
          command: 'test',
          outcome: 'retry_after_incorrect',
          document: {
            version: '1.0',
            response_id: 'r2',
            response_type: 'assessment',
            components: [{ id: 'fb', type: 'text', content: '**Not quite.** A tuple is immutable.' }],
          },
          session: SESSION,
        });
      }
      return Promise.resolve({});
    });

    renderPage();
    await screen.findAllByText('Data Structures');
    await user.click(screen.getAllByRole('button', { name: /\/test/i })[0]);

    const option = await screen.findByLabelText('A tuple');
    await user.click(option);
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() => {
      const answered = apiMock.mock.calls.find(([p, o]) => String(p).endsWith('/turn') && o?.body?.answer !== undefined);
      expect(answered).toBeTruthy();
      expect(answered[1].body.command).toBe('test');
      expect(answered[1].body.answer).toBe('A tuple');
    });

    // The verdict comes back into the conversation.
    expect(await screen.findByText(/Not quite/i)).toBeInTheDocument();
  });

  it('keeps the previous turns on screen', async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path, options) => {
      if (path === '/tracs/sess1' && !options) return Promise.resolve({ session: SESSION, open_question: null });
      if (String(path).endsWith('/turn')) {
        // Each command returns its own document, so the test can tell an
        // appended turn from a duplicated one.
        const isLearn = options.body.command === 'learn';
        return Promise.resolve({
          command: options.body.command,
          outcome: isLearn ? 'explained' : 'question',
          document: isLearn
            ? { version: '1.0', response_id: 'r3', response_type: 'educational_tutorial', components: [{ id: 'ex', type: 'text', content: 'A list is ordered and mutable.' }] }
            : oneQuestionDoc(),
          session: SESSION,
        });
      }
      return Promise.resolve({});
    });

    renderPage();
    await screen.findAllByText('Data Structures');

    await user.type(screen.getByLabelText(/^command$/i), '/learn');
    await user.click(screen.getByLabelText(/send command/i));
    expect(await screen.findByText(/A list is ordered and mutable/i)).toBeInTheDocument();

    // A second command appends rather than replacing: the conversation is the
    // product, so earlier explanations must not vanish. It must also not be
    // duplicated — one turn in, one turn on screen.
    await user.click(screen.getAllByRole('button', { name: /\/test/i })[0]);
    expect(await screen.findByText(/Which is immutable\?/i)).toBeInTheDocument();
    // One explanation in the log, not two: the earlier turn was appended to,
    // not re-rendered.
    const repeats = await screen.findAllByText(/A list is ordered and mutable/i);
    expect(repeats).toHaveLength(1);
  });
});
