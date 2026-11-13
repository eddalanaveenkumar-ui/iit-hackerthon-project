import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DynamicRenderer from '../components/DynamicRenderer/DynamicRenderer';

/**
 * THE QUESTION FORM ENGINE
 * ========================
 *
 * These tests encode the acceptance criteria for the dynamic question form:
 * one form for all questions, one submit button at the end, per-question state,
 * field-level validation, optional questions that may stay empty, preserved
 * answers on failure, duplicate-submission protection, and an AI evaluation
 * rendered underneath.
 */

const formDoc = (questions, submission) => ({
  version: '1.0',
  response_id: 'resp_form',
  response_type: 'question_form',
  metadata: { topic: 'Python basics' },
  components: [
    {
      id: 'form-1',
      type: 'question_form',
      title: 'Before we start',
      questions,
      submission: submission || { button_text: 'Submit answers', action: 'submit_ai_questions', evaluation: 'ai_evaluation' },
    },
  ],
});

const renderForm = (questions, actions = {}, submission) =>
  render(<DynamicRenderer document={formDoc(questions, submission)} actions={{ notify: vi.fn(), submitAnswers: vi.fn(), ...actions }} />);

beforeEach(() => {
  sessionStorage.clear();
});

describe('one question at a time is replaced by one form', () => {
  it('renders five questions and exactly one submit button', async () => {
    renderForm([
      { id: 'q1', type: 'text_input', question: 'What is your goal?' },
      { id: 'q2', type: 'textarea', question: 'Describe what you already know.' },
      { id: 'q3', type: 'radio', question: 'Preferred pace?', options: ['Slow', 'Steady', 'Fast'] },
      { id: 'q4', type: 'checkbox_group', question: 'Which topics interest you?', options: ['Loops', 'Functions', 'Files'] },
      { id: 'q5', type: 'number', question: 'Hours per week you can study?' },
    ]);

    await screen.findByText(/what is your goal/i);
    const submits = screen.getAllByRole('button').filter((b) => /submit answers/i.test(b.textContent));
    expect(submits).toHaveLength(1);
    // Full-width, at the end of the form.
    expect(submits[0].className).toMatch(/w-full/);
    expect(screen.getAllByRole('button').some((b) => /submit answers/i.test(b.textContent))).toBe(true);
  });

  it('renders questions in the authored order', async () => {
    renderForm([
      { id: 'q1', type: 'text_input', question: 'First question here' },
      { id: 'q2', type: 'text_input', question: 'Second question here' },
      { id: 'q3', type: 'text_input', question: 'Third question here' },
    ]);
    await screen.findByText(/first question here/i);
    // The label text carries the ordinal prefix and an "optional" marker.
    const labels = screen.getAllByText(/question here$/i).map((n) => n.textContent.replace(/\s+/g, ' ').trim());
    expect(labels.map((t) => t.replace(/^\d+\./, '').replace(/optional$/i, '').trim())).toEqual([
      'First question here',
      'Second question here',
      'Third question here',
    ]);
  });
});

describe('validation', () => {
  it('blocks submission of an empty required question and shows a field error', async () => {
    const user = userEvent.setup();
    const submitAnswers = vi.fn();
    renderForm([
      { id: 'q1', type: 'text_input', question: 'Your name', required: true },
      { id: 'q2', type: 'text_input', question: 'Optional note' },
    ], { submitAnswers });

    await user.click(await screen.findByRole('button', { name: /submit answers/i }));

    // The error appears twice by design — beside the field (aria-describedby) and
    // as the field's alert. Both must exist; neither is a duplicate render bug.
    expect(await screen.findAllByText(/this question is required/i)).not.toHaveLength(0);
    expect(submitAnswers).not.toHaveBeenCalled();
  });

  it('allows an optional question to stay empty', async () => {
    const user = userEvent.setup();
    const submitAnswers = vi.fn().mockResolvedValue({ ok: true, evaluation: { score: 80, overall: 'Good.' } });
    renderForm([
      { id: 'q1', type: 'text_input', question: 'Your name', required: true },
      { id: 'q2', type: 'text_input', question: 'Optional note' },
    ], { submitAnswers });

    const nameInput = await screen.findByLabelText(/your name/i);
    await user.type(nameInput, 'Ada');
    await user.click(screen.getByRole('button', { name: /submit answers/i }));

    await waitFor(() => expect(submitAnswers).toHaveBeenCalledTimes(1));
    const [, payload] = submitAnswers.mock.calls[0];
    // An unanswered optional question is simply absent from the payload; the
    // server records it as `unanswered` rather than rejecting the submission.
    expect(payload.answers.map((a) => a.question_id)).toEqual(['q1']);
    expect(payload.answers[0]).toEqual({ question_id: 'q1', value: 'Ada' });
  });

  it('validates a number against its declared minimum', async () => {
    const user = userEvent.setup();
    const submitAnswers = vi.fn();
    renderForm([{ id: 'q1', type: 'number', question: 'How many hours?', required: true, min: 1, max: 10 }], { submitAnswers });

    const input = await screen.findByLabelText(/how many hours/i);
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: /submit answers/i }));

    expect(await screen.findByText(/must be at least 1/i)).toBeInTheDocument();
    expect(submitAnswers).not.toHaveBeenCalled();
  });

  it('clears a field error once the answer is corrected', async () => {
    const user = userEvent.setup();
    renderForm([{ id: 'q1', type: 'text_input', question: 'Your name', required: true }]);

    await user.click(await screen.findByRole('button', { name: /submit answers/i }));
    expect(await screen.findAllByText(/this question is required/i)).not.toHaveLength(0);

    await user.type(screen.getByLabelText(/your name/i), 'Ada');
    await waitFor(() => expect(screen.queryAllByText(/this question is required/i)).toHaveLength(0));
  });

  it('disables the submit button while an identical submission is in flight', async () => {
    const user = userEvent.setup();
    let release;
    const submitAnswers = vi.fn().mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    renderForm([{ id: 'q1', type: 'text_input', question: 'Your name', required: true }], { submitAnswers });

    await user.type(await screen.findByLabelText(/your name/i), 'Ada');
    const button = screen.getByRole('button', { name: /submit answers/i });
    await user.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    await user.click(button);
    await user.click(button);
    expect(submitAnswers).toHaveBeenCalledTimes(1);

    release({ ok: true, evaluation: { score: 90, overall: 'Nicely done.' } });
    await waitFor(() => expect(screen.getByText(/nicely done/i)).toBeInTheDocument());
  });
});

describe('input types', () => {
  it('renders radio, checkbox, slider, date, boolean and code inputs', async () => {
    const user = userEvent.setup();
    const submitAnswers = vi.fn().mockResolvedValue({ ok: true, evaluation: { score: 50, overall: 'Okay.' } });
    renderForm([
      { id: 'q1', type: 'radio', question: 'Pick one', options: ['Alpha', 'Beta'], required: true },
      { id: 'q2', type: 'checkbox_group', question: 'Pick many', options: ['One', 'Two', 'Three'], required: true },
      { id: 'q3', type: 'slider', question: 'Confidence', min: 0, max: 10, step: 1, required: true },
      { id: 'q4', type: 'date', question: 'Target date', required: true },
      { id: 'q5', type: 'boolean', question: 'Have you coded before?', required: true },
      { id: 'q6', type: 'code_input', question: 'Write a print statement', language: 'python', required: true },
    ], { submitAnswers });

    await screen.findByText(/pick one/i);
    // radio + the two boolean buttons are all radios; the checkbox group adds 3.
    expect(screen.getAllByRole('radio').length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(document.querySelector('input[type="date"]')).not.toBeNull();
    expect(screen.getByLabelText(/write a print statement/i).tagName).toBe('TEXTAREA');

    const radioGroup = screen.getByRole('radiogroup', { name: /pick one/i });
    await user.click(within(radioGroup).getByRole('radio', { name: 'Beta' }));
    expect(within(radioGroup).getByRole('radio', { name: 'Beta' })).toBeChecked();
  }, 20_000);

  it('submits a checkbox group as an array of selected values', async () => {
    const user = userEvent.setup();
    const submitAnswers = vi.fn().mockResolvedValue({ ok: true, evaluation: { score: 100, overall: 'Great.' } });
    renderForm([{ id: 'q1', type: 'checkbox_group', question: 'Which topics?', options: ['Loops', 'Functions', 'Files'], required: true }], { submitAnswers });

    await user.click(await screen.findByRole('checkbox', { name: 'Loops' }));
    await user.click(screen.getByRole('checkbox', { name: 'Files' }));
    await user.click(screen.getByRole('button', { name: /submit answers/i }));

    await waitFor(() => expect(submitAnswers).toHaveBeenCalledTimes(1));
    const [, payload] = submitAnswers.mock.calls[0];
    const answer = payload.answers.find((a) => a.question_id === 'q1');
    expect(answer.value).toEqual(['Loops', 'Files']);
  });

  it('rejects a file that is too large before submitting', async () => {
    const user = userEvent.setup();
    const submitAnswers = vi.fn();
    renderForm([{ id: 'q1', type: 'file_upload', question: 'Upload your notes', accept: ['application/pdf'], required: true }], { submitAnswers });

    const input = await waitFor(() => {
      const found = document.querySelector('input[type="file"]');
      if (!found) throw new Error('file input not rendered yet');
      return found;
    });
    const big = new File(['x'], 'notes.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 });
    await user.upload(input, big);
    // Field errors appear once the student has attempted to submit.
    await user.click(screen.getByRole('button', { name: /submit answers/i }));

    expect(await screen.findByText(/limited to 2 MB/i)).toBeInTheDocument();
    expect(submitAnswers).not.toHaveBeenCalled();
  });
});

describe('submission payload and evaluation', () => {
  it('collects one payload for the whole form and sends the questions with it', async () => {
    const user = userEvent.setup();
    const submitAnswers = vi.fn().mockResolvedValue({ ok: true, evaluation: { score: 75, overall: 'Solid start.' } });
    renderForm([
      { id: 'q1', type: 'text_input', question: 'Goal', required: true },
      { id: 'q2', type: 'radio', question: 'Pace', options: ['Slow', 'Fast'], required: true },
    ], { submitAnswers }, { button_text: 'Send', action: 'submit_ai_questions', evaluation: 'ai_evaluation' });

    await user.type(await screen.findByLabelText(/goal/i), 'Learn loops');
    await user.click(screen.getByRole('radio', { name: 'Fast' }));
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(submitAnswers).toHaveBeenCalledTimes(1));
    const [formId, payload] = submitAnswers.mock.calls[0];
    expect(formId).toBe('form-1');
    expect(payload.form_id).toBe('form-1');
    expect(payload.conversation_id).toBe('form-1');
    expect(payload.answers).toEqual([
      { question_id: 'q1', value: 'Learn loops' },
      { question_id: 'q2', value: 'Fast' },
    ]);
  });

  it('shows the AI evaluation: score, per-answer feedback, gaps and next step', async () => {
    const user = userEvent.setup();
    const submitAnswers = vi.fn().mockResolvedValue({
      ok: true,
      // The exact shape `POST /api/learning/forms/submit` returns.
      evaluation: {
        overall: 'You understand the idea but the base case is shaky.',
        score: 60,
        per_question: [
          { question_id: 'q1', verdict: 'correct', feedback: 'Exactly right — the base case stops the recursion.' },
          { question_id: 'q2', verdict: 'partly_correct', feedback: 'Close, but the return value is wrong.', hint: 'Try n == 0.' },
        ],
        gaps: ['base case'],
        next_step: 'Try the practice exercise on base cases.',
        source: 'local',
      },
    });
    renderForm([
      { id: 'q1', type: 'text_input', question: 'What stops recursion?', required: true },
      { id: 'q2', type: 'code_input', question: 'Write the base case', required: true },
    ], { submitAnswers });

    await user.type(await screen.findByLabelText(/what stops recursion/i), 'a base case');
    await user.type(screen.getByLabelText(/write the base case/i), 'if n == 0: return 1');
    await user.click(screen.getByRole('button', { name: /submit answers/i }));

    // The score is rendered beside the confirmation strip.
    expect(await screen.findByText(/answers submitted · 60%/i)).toBeInTheDocument();
    expect(screen.getByText(/base case stops the recursion/i)).toBeInTheDocument();
    expect(screen.getByText(/return value is wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/partly correct/i)).toBeInTheDocument();
    expect(screen.getByText(/practice exercise on base cases/i)).toBeInTheDocument();
  });

  it('keeps every answer when the network fails, and lets the student retry', async () => {
    const user = userEvent.setup();
    const submitAnswers = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: 'Network unreachable' })
      .mockResolvedValueOnce({ ok: true, evaluation: { score: 100, overall: 'Recovered.' } });
    renderForm([
      { id: 'q1', type: 'text_input', question: 'Goal', required: true },
      { id: 'q2', type: 'textarea', question: 'Background', required: false },
    ], { submitAnswers });

    await user.type(await screen.findByLabelText(/goal/i), 'Learn recursion');
    await user.type(screen.getByLabelText(/background/i), 'I know loops');
    await user.click(screen.getByRole('button', { name: /submit answers/i }));

    expect(await screen.findByText(/network unreachable/i)).toBeInTheDocument();
    // Nothing typed is lost.
    expect(screen.getByLabelText(/goal/i)).toHaveValue('Learn recursion');
    expect(screen.getByLabelText(/background/i)).toHaveValue('I know loops');

    await user.click(screen.getByRole('button', { name: /^try again$/i }));
    await waitFor(() => expect(submitAnswers).toHaveBeenCalledTimes(2));
  });

  it('renders a follow-up form returned by the evaluation', async () => {
    const user = userEvent.setup();
    const submitAnswers = vi.fn().mockResolvedValue({
      ok: true,
      evaluation: { score: 70, overall: 'Good — one gap to close.' },
      follow_up_form: {
        id: 'follow-1',
        type: 'question_form',
        title: 'One more check',
        questions: [{ id: 'f1', type: 'boolean', question: 'Will you practise base cases today?', required: true }],
      },
    });
    renderForm([{ id: 'q1', type: 'text_input', question: 'What is recursion?', required: true }], { submitAnswers });

    await user.type(await screen.findByLabelText(/what is recursion/i), 'a function calling itself');
    await user.click(screen.getByRole('button', { name: /submit answers/i }));

    // A boolean question's label text also names its two options, so match on a
    // distinctive phrase rather than the whole label.
    expect(await screen.findByText(/practise base cases today/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit answers/i })).toBeInTheDocument();
  });

  it('restores a draft after a remount', async () => {
    const user = userEvent.setup();
    const { unmount } = renderForm([{ id: 'q1', type: 'textarea', question: 'Explain a loop', required: true }]);
    await user.type(await screen.findByLabelText(/explain a loop/i), 'It repeats.');
    unmount();

    const { container } = renderForm([{ id: 'q1', type: 'textarea', question: 'Explain a loop', required: true }]);
    await waitFor(() => expect(container.querySelector('textarea')).toHaveValue('It repeats.'));
  });
});

describe('accessibility', () => {
  it('labels every input and marks invalid fields', async () => {
    const user = userEvent.setup();
    renderForm([
      { id: 'q1', type: 'text_input', question: 'Your name', required: true },
      { id: 'q2', type: 'select', question: 'Level', options: ['New', 'Experienced'], required: true },
    ]);

    expect(await screen.findByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/level/i).tagName).toBe('SELECT');

    await user.click(screen.getByRole('button', { name: /submit answers/i }));
    await waitFor(() => expect(screen.getByLabelText(/your name/i)).toHaveAttribute('aria-invalid', 'true'));
  });

  it('groups each question with a fieldset-free but described error', async () => {
    const user = userEvent.setup();
    renderForm([{ id: 'q1', type: 'text_input', question: 'Your name', required: true }]);
    await user.click(await screen.findByRole('button', { name: /submit answers/i }));
    const alert = await screen.findByRole('alert');
    const input = screen.getByLabelText(/your name/i);
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });
});
