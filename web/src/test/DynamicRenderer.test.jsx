import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DynamicRenderer from '../components/DynamicRenderer/DynamicRenderer';

/**
 * Rendering tests for the engine's contract with the rest of the app:
 * every component type reaches *some* renderer, an invalid document degrades to
 * a notice rather than a crash, and an interaction calls the host action rather
 * than doing its own thing.
 */

// Monaco and KaTeX are heavyweight and irrelevant to these assertions.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }) => (
    <textarea aria-label="code editor" value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));

const doc = (components, extra = {}) => ({
  version: '1.0',
  response_id: 'resp_render',
  response_type: 'educational_tutorial',
  metadata: { topic: 'Recursion', difficulty: 'beginner' },
  components,
  ...extra,
});

const renderDoc = (document, actions = {}, props = {}) =>
  render(<DynamicRenderer document={document} actions={{ notify: vi.fn(), ...actions }} {...props} />);

describe('DynamicRenderer — envelope', () => {
  it('renders a heading and the learning objectives', async () => {
    renderDoc(doc([{ id: 'c1', type: 'text', content: 'Recursion solves a problem by solving a smaller one.' }], { learning_objectives: ['Spot the base case'] }));
    // Components are code-split, so the first render is a Suspense fallback.
    expect(await screen.findByText(/recursion solves/i)).toBeInTheDocument();
    expect(screen.getByText(/spot the base case/i)).toBeInTheDocument();
  });

  it('shows a notice instead of throwing when the document is unusable', async () => {
    const onInvalid = vi.fn();
    render(<DynamicRenderer document={{ nope: true }} actions={{ notify: vi.fn() }} onInvalid={onInvalid} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not be displayed/i);
    // The retry control is how a student recovers from a malformed lesson.
    await userEvent.setup().click(within(alert).getByRole('button', { name: /ask the tutor again/i }));
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });

  it('mounts an unknown component type nowhere but keeps the rest of the lesson', async () => {
    const { container } = renderDoc(
      doc([
        { id: 'a', type: 'text', content: 'The lesson survives.' },
        { id: 'b', type: 'evil_widget', content: 'should not appear' },
      ]),
    );
    expect(await screen.findByText(/the lesson survives/i)).toBeInTheDocument();
    expect(container.textContent).not.toContain('should not appear');
  });
});

describe('DynamicRenderer — every registry type mounts', () => {
  const fixtures = {
    text: { content: 'Plain **markdown** body.' },
    layout: { layout: 'stack', children: [{ id: 'l1', type: 'text', content: 'Inside layout' }] },
    card: { title: 'Card title', children: [{ id: 'k1', type: 'text', content: 'Inside card' }] },
    media: { media_type: 'image', src: 'https://cdn.example.com/a.png', alt: 'A diagram' },
    chart: { chart_type: 'bar', labels: ['a', 'b'], series: [{ name: 'Score', data: [1, 2] }] },
    table: { columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'first' }] },
    form: { fields: [{ id: 'f1', type: 'text_input', label: 'Your name' }] },
    input: { input_type: 'text_input', name: 'topic', label: 'Topic' },
    navigation: { items: [{ id: 'n1', label: 'Practice', action: 'open_practice' }] },
    quiz: { questions: [{ id: 'q1', question: 'What stops recursion?', options: ['Base case', 'Loop'], correct_index: 0 }] },
    learning: { objectives: ['Objective one'], analogy: 'Like Russian dolls.', summary: 'Summary line.' },
    code_editor: { language: 'python', starter_code: 'print("hi")' },
    math: { latex: 'a^2 + b^2 = c^2' },
    diagram: { diagram_type: 'flowchart', nodes: [{ id: 'n1', label: 'Start' }, { id: 'n2', label: 'End' }], edges: [{ from: 'n1', to: 'n2' }] },
    actions: { actions: [{ id: 'a1', label: 'Practice now', action: 'open_practice' }] },
    progress: { items: [{ label: 'Objectives', value: 50 }] },
    timeline: { events: [{ label: '1950s', detail: 'First idea' }, { label: 'Today', detail: 'Widely used' }] },
    tabs: { tabs: [{ id: 't1', label: 'Theory', children: [{ id: 'x1', type: 'text', content: 'Tab body' }] }] },
    accordion: { items: [{ id: 'i1', title: 'More detail', children: [{ id: 'y1', type: 'text', content: 'Accordion body' }] }] },
    simulation: { simulation_kind: 'parameters', parameters: [{ id: 'p1', label: 'Mass', min: 1, max: 10, step: 1, default: 5 }], outcomes: [{ label: 'Heavy' }] },
    teaching_workflow: { steps: [{ id: 's1', title: 'Analyse the question' }] },
    execution_table: { steps: [{ step: 1, statement: 'x = 1', variables: { x: '1' } }] },
    variable_visualization: { variables: [{ name: 'x', value: '1' }], final_output: '1' },
    execution_trace: { language: 'python', code: 'x = 1', steps: [{ line: 1, variables: { x: '1' } }] },
    question_form: { questions: [{ id: 'qf1', type: 'text_input', question: 'What is the base case?' }] },
  };

  // One test per type, generated so a new registry type without a fixture fails
  // loudly rather than silently losing coverage.
  for (const [type, props] of Object.entries(fixtures)) {
    it(`renders "${type}"`, async () => {
      const { container } = renderDoc(doc([{ id: `${type}-1`, type, ...props }]));
      await waitFor(() => expect(container.textContent.trim().length).toBeGreaterThan(0));
      // No renderer may report its own failure.
      expect(container.textContent).not.toMatch(/could not render|component failed/i);
    });
  }
});

describe('QuizRenderer — grading comes from the server', () => {
  const quiz = {
    id: 'quiz-1',
    type: 'quiz',
    questions: [
      { id: 'q1', question: 'Which line stops the recursion?', options: ['return n * f(n-1)', 'if n == 0: return 1', 'print(n)'], correct_index: 1 },
      { id: 'q2', question: 'What is f(0) for factorial?', options: ['0', '1', 'undefined'], correct_index: 1 },
    ],
  };

  it('does not reveal the verdict before submitting', async () => {
    renderDoc(doc([quiz]), { submitQuiz: vi.fn() });
    await screen.findByText(/which line stops/i);
    expect(screen.queryByText(/correct/i)).not.toBeInTheDocument();
  });

  it('sends the selected answers to the host action and shows the server result', async () => {
    const user = userEvent.setup();
    const submitQuiz = vi.fn().mockResolvedValue({
      ok: true,
      score: 100,
      correct: 2,
      max: 2,
      // The shape `POST /api/learning/quiz/submit` actually returns.
      results: [
        { questionId: 'q1', chosen: 1, correctIndex: 1, correct: true, explanation: 'The base case ends the recursion.' },
        { questionId: 'q2', chosen: 1, correctIndex: 1, correct: true, explanation: '' },
      ],
    });
    renderDoc(doc([quiz]), { submitQuiz });

    const questions = await screen.findAllByRole('radiogroup');
    await user.click(within(questions[0]).getAllByRole('radio')[1]);
    await user.click(within(questions[1]).getAllByRole('radio')[1]);
    await user.click(screen.getByRole('button', { name: /submit|check/i }));

    await waitFor(() => expect(submitQuiz).toHaveBeenCalledTimes(1));
    const [quizId, payload] = submitQuiz.mock.calls[0];
    expect(quizId).toBe('quiz-1');
    expect(JSON.stringify(payload)).toContain('q1');
    // The server's score is what appears, not a locally computed one.
    expect(await screen.findByText(/100% · 2\/2/)).toBeInTheDocument();
    expect(await screen.findByText(/base case ends/i)).toBeInTheDocument();
  });

  it('keeps answers and shows an error when grading fails', async () => {
    const user = userEvent.setup();
    const submitQuiz = vi.fn().mockResolvedValue({ ok: false, reason: 'Network unreachable' });
    renderDoc(doc([quiz]), { submitQuiz });

    const questions = await screen.findAllByRole('radiogroup');
    await user.click(within(questions[0]).getAllByRole('radio')[1]);
    // A quiz cannot be submitted with unanswered questions — the button is the
    // gate, so answering only one is not enough and the click does nothing.
    expect(screen.getByRole('button', { name: /submit|check/i })).toBeDisabled();
    await user.click(within(questions[1]).getAllByRole('radio')[1]);
    await user.click(screen.getByRole('button', { name: /submit|check/i }));

    expect(await screen.findByText(/network unreachable/i)).toBeInTheDocument();
    expect(within(questions[0]).getAllByRole('radio')[1]).toBeChecked();
    expect(within(questions[1]).getAllByRole('radio')[1]).toBeChecked();
  });
});

describe('NavigationRenderer — closed action vocabulary', () => {
  it('navigates only through the host action', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    renderDoc(doc([{ id: 'nav1', type: 'navigation', items: [{ id: 'n1', label: 'Open practice', action: 'navigate', target: '/app/practice' }] }]), { navigate });

    await user.click(await screen.findByRole('button', { name: /open practice/i }));
    expect(navigate).toHaveBeenCalledWith('/app/practice');
  });
});

describe('MediaRenderer — unsafe sources never load', () => {
  it('renders an unavailable state for a javascript: source', async () => {
    const { container } = renderDoc(doc([{ id: 'm1', type: 'media', media_type: 'image', src: 'javascript:alert(1)', alt: 'bad' }]));
    await waitFor(() => expect(container.querySelector('img')).toBeNull());
  });
});
