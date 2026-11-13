import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DynamicRenderer from '../components/DynamicRenderer/DynamicRenderer';
import { validateUI } from '../components/DynamicRenderer/utils/validateUI';
import tracsDocuments from './fixtures/tracsDocuments.json';

/**
 * THE SEAM BETWEEN THE SERVER AND THE RENDERER
 * ============================================
 *
 * `fixtures/tracsDocuments.json` is not hand-written. It is the literal output
 * of the tracs API, captured from a running server: a `/test` question, the
 * verdict document after answering it, and a `/learn` explanation.
 *
 * The server tests prove the API produces those documents. The renderer tests
 * prove a document renders. Neither proves the *first* thing against the
 * *second* — that what the API actually emits is something the client
 * validator keeps. A document the validator quietly drops produces a blank
 * panel with no error anywhere, which is exactly the failure this test exists
 * to catch.
 *
 * Regenerate the fixture with `server/tests/tracs-live.mjs` against a live
 * server if the document shape changes.
 */

vi.mock('@monaco-editor/react', () => ({ default: ({ value }) => <textarea readOnly value={value} /> }));

const actions = {
  notify: vi.fn(),
  submitAnswers: vi.fn(),
  submitQuiz: vi.fn(),
  runCode: vi.fn(),
  markComplete: vi.fn(),
  navigate: vi.fn(),
  continueLesson: vi.fn(),
};

describe('documents the tracs API really emits', () => {
  for (const [name, document] of Object.entries(tracsDocuments)) {
    describe(name, () => {
      it('survives the client validator without losing a component', () => {
        const result = validateUI(document);
        expect(result.ok).toBe(true);
        expect(result.dropped).toEqual([]);
        // Nothing is dropped and nothing silently disappears.
        expect(result.document.components.length).toBe(document.components.length);
      });

      it('renders with no error boundary and no empty shell', async () => {
        const { container } = render(<DynamicRenderer document={document} actions={actions} />);
        await waitFor(() => expect(container.textContent.length).toBeGreaterThan(20));
        expect(container.textContent).not.toMatch(/could not be displayed/i);
      });
    });
  }

  it('the /test document asks exactly one question', () => {
    const forms = tracsDocuments.testQuestion.components.filter((c) => c.type === 'question_form');
    expect(forms).toHaveLength(1);
    expect(forms[0].questions).toHaveLength(1);
  });

  it('the verdict document carries one next question, not the previous one', () => {
    const forms = tracsDocuments.testVerdict.components.filter((c) => c.type === 'question_form');
    expect(forms.length).toBeLessThanOrEqual(1);
    for (const form of forms) expect(form.questions).toHaveLength(1);
  });

  it('the /learn document explains and then checks', () => {
    const types = tracsDocuments.learn.components.map((c) => c.type);
    expect(types).toContain('learning');
    const forms = tracsDocuments.learn.components.filter((c) => c.type === 'question_form');
    expect(forms).toHaveLength(1);
    expect(forms[0].questions).toHaveLength(1);
  });
});
