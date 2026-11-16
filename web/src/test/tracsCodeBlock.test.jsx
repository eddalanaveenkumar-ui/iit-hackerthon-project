import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import QuestionFormRenderer from '../components/DynamicRenderer/components/QuestionFormRenderer';

/**
 * CODE IN A CONTAINER
 * ===================
 *
 * A coding question used to arrive as one sentence with the program inside it:
 *
 *   After executing `x = 10; x = 'hello'`, what is the type of `x`?
 *
 * which the learner had to read a program out of. The server now lifts the
 * program into `code_snippet` and reports the spans it came from (`code_inline`).
 * This pins what the learner actually sees:
 *
 *  - the program is in a <pre> block, with its statements on separate lines;
 *  - the sentence no longer repeats the code, it points at the block instead;
 *  - a question with no code renders exactly as before.
 */

const form = (question) => ({
  id: 'form_1',
  type: 'question_form',
  title: 'Variables and Primitive Types',
  questions: [{ id: 'q1', type: 'radio', required: true, options: ['a', 'b', 'c', 'd'], ...question }],
});

const actions = { submitAnswers: vi.fn(), notify: vi.fn() };

describe('a question about code', () => {
  const question = {
    question: 'Java has `int total = 7;` and later `total = 7.5;`. What happens?',
    code_snippet: 'int total = 7;\ntotal = 7.5;',
    code_inline: ['`int total = 7;`', '`total = 7.5;`'],
    language: 'java',
  };

  it('shows the program in its own block', () => {
    const { container } = render(<QuestionFormRenderer component={form(question)} actions={actions} />);
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    // Every line of the program is present, on its own line.
    expect(pre.textContent).toContain('int total = 7;');
    expect(pre.textContent).toContain('total = 7.5;');
    const lines = pre.querySelectorAll('code > span');
    expect(lines.length).toBe(2);
  });

  it('names the language so the block is labelled', () => {
    render(<QuestionFormRenderer component={form(question)} actions={actions} />);
    expect(screen.getByText('Java')).toBeTruthy();
  });

  it('does not repeat the code in the sentence', () => {
    const { container } = render(<QuestionFormRenderer component={form(question)} actions={actions} />);
    const pre = container.querySelector('pre');
    // The prose should point at the block rather than restate the program.
    const label = container.querySelector('ol li label');
    expect(label.textContent).toContain('the code above');
    expect(label.textContent).not.toContain('int total = 7;');
    // …and the program itself still exists, once, in the block.
    expect(pre.textContent).toContain('int total = 7;');
  });

  it('points at the block once, even when the program was written as two spans', () => {
    // "Java has `a` and later `b`" is one program, so it gets one pointer.
    // Two pointers would read "Java has the code above and later the code
    // above" — worse than the sentence we started with.
    const { container } = render(<QuestionFormRenderer component={form(question)} actions={actions} />);
    const label = container.querySelector('ol li label');
    expect(label.textContent.match(/the code above/g)?.length).toBe(1);
  });

  it('leaves backticks it did not lift inline', () => {
    // Only the lifted program goes into the block; `x` is still a term in the
    // sentence, so the question stays specific.
    const { container } = render(
      <QuestionFormRenderer
        component={form({
          question: 'After `x = 10; x = "hi"; x = 3.14`, what is the type of `x`?',
          code_snippet: 'x = 10; x = "hi"; x = 3.14',
          code_inline: ['`x = 10; x = "hi"; x = 3.14`'],
          language: 'python',
        })}
        actions={actions}
      />,
    );
    const label = container.querySelector('ol li label');
    expect(label.textContent).toContain('After the code above, what is the type of `x`?');
    expect(container.querySelector('pre').textContent).toContain('x = 10; x = "hi"; x = 3.14');
  });

  it('keeps the rest of the sentence readable', () => {
    const { container } = render(<QuestionFormRenderer component={form(question)} actions={actions} />);
    const label = container.querySelector('ol li label');
    expect(label.textContent).toContain('What happens?');
  });
});

describe('a program the model wrote without backticks', () => {
  // The server finds the program by its shape and returns the instruction as
  // the stem, with the program laid out. The learner must see the block, and
  // must not see the program in the sentence any more.
  const question = {
    question: 'What does this code print?',
    code_snippet: "x = 7\nif x > 10:\n    print('A')\nelif x > 5:\n    print('B')\nelse:\n    print('C')",
    language: 'python',
  };

  it('shows the program as a block with one statement per line', () => {
    const { container } = render(<QuestionFormRenderer component={form(question)} actions={actions} />);
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    /**
     * Only the *code* lines belong in the block. The line-number column is
     * `aria-hidden` but still text, so count the code column specifically.
     */
    const codeLines = [...pre.querySelectorAll('code > span > span:last-child')].map((s) => s.textContent);
    expect(codeLines).toEqual(['x = 7', 'if x > 10:', "    print('A')", 'elif x > 5:', "    print('B')", 'else:', "    print('C')"]);
  });

  it('keeps the instruction readable and separate', () => {
    const { container } = render(<QuestionFormRenderer component={form(question)} actions={actions} />);
    const label = container.querySelector('ol li label');
    expect(label.textContent).toContain('What does this code print?');
    expect(label.textContent).not.toContain('print(');
  });

  it('labels the block as Python', () => {
    render(<QuestionFormRenderer component={form(question)} actions={actions} />);
    expect(screen.getByText('Python')).toBeTruthy();
  });
});

describe('a question with no code', () => {
  it('renders the sentence exactly as written', () => {
    const { container } = render(
      <QuestionFormRenderer
        component={form({ question: 'Which statement about None is correct?' })}
        actions={actions}
      />,
    );
    expect(container.querySelector('pre')).toBeNull();
    const label = container.querySelector('ol li label');
    expect(label.textContent).toContain('Which statement about None is correct?');
    expect(label.textContent).not.toContain('the code above');
  });
});
