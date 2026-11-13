import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import fixtures from './fixtures/generated-lessons.json';
import DynamicRenderer from '../components/DynamicRenderer/DynamicRenderer';
import { validateUI } from '../components/DynamicRenderer/utils/validateUI';

/**
 * REAL MODEL OUTPUT, NOT HAND-WRITTEN FIXTURES
 * ============================================
 *
 * `fixtures/generated-lessons.json` was captured from a live
 * `POST /api/ai-tutor/generate` (source: "model", not the offline engine) for
 * three different subjects. Hand-written fixtures encode what we *think* the
 * model writes; these encode what it actually wrote, including the shapes we did
 * not anticipate.
 *
 * If a change to the schema or the renderer breaks a real lesson, this fails.
 * Re-capture the fixture when the protocol changes intentionally.
 */

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }) => <textarea aria-label="code editor" value={value} readOnly />,
}));

const lessons = Object.entries(fixtures);

describe('every real generated lesson validates without repair', () => {
  for (const [prompt, entry] of lessons) {
    it(`"${prompt}" passes validation cleanly`, () => {
      const result = validateUI(entry.document);
      expect(result.ok).toBe(true);
      // A clean fixture must not need repairs: if it does, the schema and the
      // prompt have drifted apart and real lessons are being silently altered.
      expect(result.dropped).toEqual([]);
      expect(result.issues).toEqual([]);
      expect(result.stats.total).toBeGreaterThan(3);
    });
  }
});

describe('every real generated lesson renders', () => {
  for (const [prompt, entry] of lessons) {
    it(`"${prompt}" renders with no failed section`, async () => {
      const { container } = render(<DynamicRenderer document={entry.document} actions={{ notify: vi.fn(), submitQuiz: vi.fn(), runCode: vi.fn() }} />);
      await waitFor(() => expect(container.textContent.length).toBeGreaterThan(200));
      expect(container.textContent).not.toMatch(/could not be displayed|could not be rendered/i);
      expect(screen.queryByText(/was skipped because the tutor/i)).not.toBeInTheDocument();
    });
  }
});

describe('the recursion lesson satisfies the brief', () => {
  const document = fixtures['Teach me recursion in Python'].document;
  const types = document.components.map((c) => c.type);

  it('has an explanation, an analogy and a diagram', () => {
    expect(types).toContain('learning');
    expect(types).toContain('text');
    expect(types).toContain('diagram');
  });

  it('has runnable Python and a step-by-step trace', () => {
    expect(types).toContain('code_editor');
    expect(types).toContain('execution_trace');
    const code = document.components.find((c) => c.type === 'code_editor');
    expect(code.language).toBe('python');
  });

  it('has practice, a knowledge check and a next step', () => {
    expect(types).toContain('question_form');
    expect(types).toContain('quiz');
    expect(types).toContain('actions');
  });

  it('carries learning objectives', () => {
    expect(document.learning_objectives.length).toBeGreaterThanOrEqual(2);
  });

  it('does not answer the quiz in the payload the student receives', async () => {
    // The renderer receives `correct_index` (the lesson is inspectable), but the
    // UI must not reveal it before submission. This asserts the *rendering*
    // contract: no verdict appears until the server grades.
    render(<DynamicRenderer document={document} actions={{ notify: vi.fn(), submitQuiz: vi.fn() }} />);
    const quiz = document.components.find((c) => c.type === 'quiz');
    await screen.findByText(quiz.questions[0].question);
    expect(screen.queryByText(/^correct$/i)).not.toBeInTheDocument();
  });
});

describe('different subjects choose different components', () => {
  it('the maths lesson uses math and chart but no code editor', () => {
    const document = fixtures['Teach me derivatives in calculus'].document;
    const types = document.components.map((c) => c.type);
    expect(types).toContain('math');
    expect(types).toContain('chart');
    expect(types).not.toContain('code_editor');
  });

  it('the machine-learning lesson uses a simulation and a diagram', () => {
    const document = fixtures['How does gradient descent work?'].document;
    const types = document.components.map((c) => c.type);
    expect(types).toContain('simulation');
    expect(types).toContain('diagram');
    expect(types).toContain('chart');
  });

  it('the component choice is genuinely different across subjects', () => {
    const signature = (prompt) => fixtures[prompt].document.components.map((c) => c.type).sort().join(',');
    const signatures = lessons.map(([prompt]) => signature(prompt));
    expect(new Set(signatures).size).toBe(signatures.length);
  });
});
