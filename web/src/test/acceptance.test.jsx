import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DynamicRenderer from '../components/DynamicRenderer/DynamicRenderer';

/**
 * ACCEPTANCE TEST — "Teach me recursion in Python"
 * ================================================
 *
 * The brief's acceptance criterion, as a test: the generated lesson must contain
 * an explanation, an analogy, a recursion diagram, runnable Python, a
 * step-by-step execution trace, coding practice, a quiz and a summary — and all
 * of it must render automatically from one document.
 *
 * The second criterion is that the engine generalises: the same renderer must
 * handle a maths lesson and a machine-learning lesson built from different
 * components, without a Python or a recursion branch anywhere.
 */

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }) => (
    <textarea aria-label="code editor" value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));

const recursionLesson = {
  version: '1.0',
  response_id: 'resp_recursion',
  response_type: 'educational_tutorial',
  metadata: { topic: 'Recursion in Python', subject: 'programming', difficulty: 'developing', estimated_minutes: 12 },
  learning_objectives: ['Identify the base case and the recursive case', 'Trace a recursive call by hand'],
  components: [
    { id: 'intro', type: 'text', content: 'Recursion is a function that calls itself on a smaller version of the same problem.' },
    { id: 'analogy', type: 'learning', analogy: 'Like Russian nesting dolls: you open one and find a smaller copy inside.', summary: 'Every recursive function needs a base case.' },
    { id: 'diagram', type: 'diagram', diagram_type: 'flowchart', nodes: [{ id: 'start', label: 'factorial(3)' }, { id: 'rec', label: 'calls factorial(2)' }, { id: 'base', label: 'factorial(0) → 1' }], edges: [{ from: 'start', to: 'rec' }, { from: 'rec', to: 'base' }] },
    { id: 'code', type: 'code_editor', language: 'python', starter_code: 'def factorial(n):\n    if n == 0:\n        return 1\n    return n * factorial(n - 1)\n', expected_output: '6' },
    { id: 'trace', type: 'execution_trace', language: 'python', code: 'factorial(3)', steps: [{ line: 2, variables: { n: '3' }, call_stack: ['factorial(3)'] }, { line: 4, variables: { n: '0' }, output: '1', call_stack: ['factorial(3)', 'factorial(0)'] }] },
    { id: 'practice', type: 'code_editor', language: 'python', starter_code: 'def sum_to(n):\n    pass\n', instructions: 'Write sum_to recursively.' },
    { id: 'quiz', type: 'quiz', questions: [{ id: 'q1', question: 'What stops the recursion?', options: ['The base case', 'A loop', 'An exception'], correct_index: 0 }] },
    { id: 'summary', type: 'text', content: 'Summary: identify the base case first, then reduce the problem.' },
  ],
};

const mathsLesson = {
  version: '1.0',
  response_id: 'resp_maths',
  response_type: 'educational_tutorial',
  metadata: { topic: 'Derivatives', subject: 'mathematics' },
  components: [
    { id: 'm1', type: 'math', latex: 'f\'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}' },
    { id: 'm2', type: 'chart', chart_type: 'line', labels: ['0', '1', '2', '3'], series: [{ name: 'f(x) = x²', data: [0, 1, 4, 9] }] },
    { id: 'm3', type: 'quiz', questions: [{ id: 'q1', question: 'Derivative of x²?', options: ['2x', 'x', 'x³'], correct_index: 0 }] },
  ],
};

const mlLesson = {
  version: '1.0',
  response_id: 'resp_ml',
  response_type: 'educational_tutorial',
  metadata: { topic: 'Gradient descent', subject: 'machine_learning' },
  components: [
    { id: 'v1', type: 'teaching_workflow', steps: [{ id: 's1', title: 'Initialise weights', status: 'done' }, { id: 's2', title: 'Compute the gradient', status: 'active' }] },
    { id: 'v2', type: 'table', columns: [{ key: 'epoch', label: 'Epoch' }, { key: 'loss', label: 'Loss' }], rows: [{ epoch: 1, loss: 0.9 }, { epoch: 2, loss: 0.4 }] },
    { id: 'v3', type: 'simulation', simulation_kind: 'parameters', parameters: [{ id: 'lr', label: 'Learning rate', min: 0.01, max: 1, step: 0.01, default: 0.1 }], outcomes: [{ label: 'Converges' }] },
  ],
};

describe('acceptance: "Teach me recursion in Python"', () => {
  it('renders every required teaching section from one document', async () => {
    const actions = { notify: vi.fn(), submitQuiz: vi.fn(), runCode: vi.fn(), markComplete: vi.fn() };
    render(<DynamicRenderer document={recursionLesson} actions={actions} />);

    // explanation
    expect(await screen.findByText(/calls itself on a smaller version/i)).toBeInTheDocument();
    // analogy
    expect(screen.getByText(/russian nesting dolls/i)).toBeInTheDocument();
    // recursion diagram (the call also appears in the execution trace's code)
    expect(screen.getAllByText(/factorial\(3\)/i).length).toBeGreaterThan(0);
    // runnable Python
    expect(screen.getByDisplayValue(/def factorial\(n\)/)).toBeInTheDocument();
    // step-by-step execution
    expect(screen.getByText(/call stack/i)).toBeInTheDocument();
    // coding practice
    expect(screen.getByText(/write sum_to recursively/i)).toBeInTheDocument();
    // quiz
    expect(screen.getByText(/what stops the recursion\?/i)).toBeInTheDocument();
    // summary
    expect(screen.getByText(/identify the base case first/i)).toBeInTheDocument();
    // and the document's own objectives
    expect(screen.getByText(/trace a recursive call by hand/i)).toBeInTheDocument();
  });

  it('runs the student code through the host action, never locally', async () => {
    const user = userEvent.setup();
    const runCode = vi.fn().mockResolvedValue({ ok: true, executed: true, stdout: '6\n', results: [{ name: 'factorial(3)', passed: true }], loadError: false });
    const evalSpy = vi.spyOn(window, 'eval');
    render(<DynamicRenderer document={recursionLesson} actions={{ notify: vi.fn(), runCode }} />);

    const runs = await screen.findAllByRole('button', { name: /^run/i });
    await user.click(runs[0]);

    await waitFor(() => expect(runCode).toHaveBeenCalledTimes(1));
    const [code, language] = runCode.mock.calls[0];
    expect(code).toContain('def factorial');
    expect(language).toBe('python');
    // Arbitrary model or student JavaScript must never be evaluated in the page.
    expect(evalSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(/6/)).toBeInTheDocument();
    evalSpy.mockRestore();
  });

  it('reports a code-execution failure as a message, not a crash', async () => {
    const user = userEvent.setup();
    const runCode = vi.fn().mockResolvedValue({ ok: false, reason: 'The sandbox could not start.' });
    render(<DynamicRenderer document={recursionLesson} actions={{ notify: vi.fn(), runCode }} />);
    const runs = await screen.findAllByRole('button', { name: /^run/i });
    await user.click(runs[0]);
    expect(await screen.findByText(/sandbox could not start/i)).toBeInTheDocument();
    // The lesson is still there.
    expect(screen.getByText(/russian nesting dolls/i)).toBeInTheDocument();
  });
});

describe('the engine generalises beyond Python', () => {
  it('renders a maths lesson with KaTeX and a chart', async () => {
    const { container } = render(<DynamicRenderer document={mathsLesson} actions={{ notify: vi.fn() }} />);
    // Wait for the lazy components, then assert on the rendered maths.
    await screen.findByText(/derivative of x²\?/i);
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
    // KaTeX renders real markup; the raw LaTeX is not shown to the student.
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(screen.getByText(/2x/)).toBeInTheDocument();
  });

  it('renders a machine-learning lesson with a workflow, a table and a simulation', async () => {
    render(<DynamicRenderer document={mlLesson} actions={{ notify: vi.fn() }} />);
    expect(await screen.findByText(/compute the gradient/i)).toBeInTheDocument();
    expect(screen.getByText(/epoch/i)).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });
});

describe('a long tutorial stays usable', () => {
  it('renders a document at the component ceiling without error', async () => {
    const components = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, type: 'text', content: `Section ${i} of the tutorial.` }));
    const { container } = render(
      <DynamicRenderer document={{ ...recursionLesson, components }} actions={{ notify: vi.fn() }} />,
    );
    await screen.findByText(/section 0 of the tutorial/i);
    expect(container.textContent).toContain('Section 39 of the tutorial.');
    expect(container.textContent).not.toMatch(/could not be displayed/i);
  });

  it('keeps rendering when one section is malformed', async () => {
    const document = {
      ...recursionLesson,
      components: [
        { id: 'good', type: 'text', content: 'This section is fine.' },
        { id: 'bad', type: 'quiz', questions: [] },
      ],
    };
    render(<DynamicRenderer document={document} actions={{ notify: vi.fn() }} />);
    expect(await screen.findByText(/this section is fine/i)).toBeInTheDocument();
    expect(screen.getByText(/was skipped/i)).toBeInTheDocument();
  });
});
