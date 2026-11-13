import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DynamicRenderer from '../components/DynamicRenderer/DynamicRenderer';
import ResumeCard from '../components/ResumeCard';

/**
 * PROGRESS AND RESUME
 * ===================
 *
 * Two behaviours that looked implemented but were not:
 *
 *  - a graded quiz never marked its section complete, so a finished lesson read
 *    as unfinished and the progress bar stalled;
 *  - `GET /api/learning/resume` was built and never called, so a student who
 *    closed a half-finished lesson had no route back to it.
 */

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }) => <textarea aria-label="code editor" value={value} readOnly />,
}));

const quizDoc = (id = 'quiz-1') => ({
  version: '1.0',
  response_id: 'resp_progress',
  response_type: 'educational_tutorial',
  components: [
    {
      id,
      type: 'quiz',
      questions: [{ id: 'q1', question: 'What stops recursion?', options: ['A loop', 'The base case'], correct_index: 1 }],
    },
  ],
});

describe('a graded quiz completes its section', () => {
  it('calls markComplete once the server returns a score', async () => {
    const user = userEvent.setup();
    const markComplete = vi.fn().mockResolvedValue({ ok: true });
    const submitQuiz = vi.fn().mockResolvedValue({ ok: true, score: 100, correct: 1, max: 1, results: [] });

    render(<DynamicRenderer document={quizDoc()} actions={{ notify: vi.fn(), submitQuiz, markComplete }} />);

    const group = await screen.findByRole('radiogroup');
    await user.click(group.querySelectorAll('input[type="radio"]')[1]);
    await user.click(screen.getByRole('button', { name: /submit|check/i }));

    await waitFor(() => expect(markComplete).toHaveBeenCalledWith('quiz-1'));
  });

  it('does not mark the section complete when grading fails', async () => {
    const user = userEvent.setup();
    const markComplete = vi.fn();
    const submitQuiz = vi.fn().mockResolvedValue({ ok: false, reason: 'Network unreachable' });

    render(<DynamicRenderer document={quizDoc()} actions={{ notify: vi.fn(), submitQuiz, markComplete }} />);

    const group = await screen.findByRole('radiogroup');
    await user.click(group.querySelectorAll('input[type="radio"]')[1]);
    await user.click(screen.getByRole('button', { name: /submit|check/i }));

    await screen.findByText(/network unreachable/i);
    // A failed submission is not evidence of completion.
    expect(markComplete).not.toHaveBeenCalled();
  });

  it('survives a host that does not provide markComplete', async () => {
    const user = userEvent.setup();
    const submitQuiz = vi.fn().mockResolvedValue({ ok: true, score: 100, correct: 1, max: 1, results: [] });
    // No markComplete in the action bag at all — must not throw.
    render(<DynamicRenderer document={quizDoc()} actions={{ notify: vi.fn(), submitQuiz }} />);

    const group = await screen.findByRole('radiogroup');
    await user.click(group.querySelectorAll('input[type="radio"]')[1]);
    await user.click(screen.getByRole('button', { name: /submit|check/i }));

    expect(await screen.findByText(/100% · 1\/1/)).toBeInTheDocument();
  });
});

describe('ResumeCard', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // `api()` reads response.text() and parses it itself, so the mock must
  // provide text(), not just json() — otherwise the call throws internally and
  // fetchResume's catch turns it into "nothing to resume".
  const mockResume = (payload) => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    });
  };

  const renderCard = () =>
    render(
      <MemoryRouter>
        <ResumeCard />
      </MemoryRouter>,
    );

  beforeEach(() => {
    localStorage.setItem('learnmate.token', 'test-token');
  });

  it('renders the most recent lesson with its progress', async () => {
    mockResume({
      lesson: {
        lessonId: 'ui_abc123',
        prompt: 'Teach me recursion in Python',
        document: { metadata: { topic: 'Recursion in Python' } },
        createdAt: new Date().toISOString(),
      },
      progress: { percent: 40, status: 'in_progress' },
      concept: { id: 'c1', name: 'Recursion' },
    });

    renderCard();
    expect(await screen.findByText(/pick up where you left off/i)).toBeInTheDocument();
    expect(screen.getByText('Recursion')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open recursion/i })).toHaveAttribute('href', '/app/lesson/ui_abc123');
  });

  it('says "continue" for an unfinished lesson and "open" for a finished one', async () => {
    mockResume({ lesson: { lessonId: 'l1', prompt: 'Loops' }, progress: { percent: 30 } });
    const { unmount } = renderCard();
    expect(await screen.findByRole('link', { name: /open loops|open your lesson/i })).toHaveTextContent(/continue/i);
    unmount();

    mockResume({ lesson: { lessonId: 'l2', prompt: 'Loops' }, progress: { percent: 100, status: 'completed' } });
    renderCard();
    expect(await screen.findByText(/revisit/i)).toBeInTheDocument();
  });

  it('renders nothing when there is no lesson to resume', async () => {
    mockResume({ lesson: null, progress: null });
    const { container } = renderCard();
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the request fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    const { container } = renderCard();
    await waitFor(() => expect(container.innerHTML).toBe(''));
    // A resume prompt must never turn the landing page into an error message.
    expect(container.textContent).not.toMatch(/error|failed/i);
  });

  it('can be dismissed for the session', async () => {
    mockResume({ lesson: { lessonId: 'l1', prompt: 'Loops' }, progress: { percent: 10 } });
    renderCard();
    await screen.findByText(/pick up where you left off/i);

    await userEvent.setup().click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/pick up where you left off/i)).not.toBeInTheDocument();
  });
});
