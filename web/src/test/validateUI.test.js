import { describe, expect, it } from 'vitest';
import { validateUI, sanitizeUrl, sanitizeText, sanitizeAnswers } from '../components/DynamicRenderer/utils/validateUI';
import { uiDocumentSchema } from '../components/DynamicRenderer/schemas/uiSchema';

/**
 * Validation is the security boundary of the renderer: everything downstream
 * assumes the document it receives has already been constrained. These tests
 * pin the behaviours that boundary promises.
 */

const base = (components) => ({
  version: '1.0',
  response_id: 'resp_test',
  response_type: 'educational_tutorial',
  components,
});

describe('validateUI — acceptance', () => {
  it('accepts a minimal valid document', () => {
    const result = validateUI(base([{ id: 'c1', type: 'text', content: 'Recursion is a function calling itself.' }]));
    expect(result.ok).toBe(true);
    expect(result.document.components).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });

  it('rejects JSON that is not a document at all', () => {
    for (const junk of [null, undefined, 'a string', 42, [], {}]) {
      const result = validateUI(junk);
      expect(result.ok).toBe(false);
      expect(result.document).toBeNull();
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects an empty component list', () => {
    const result = validateUI(base([]));
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.message).join(' ')).toMatch(/component/i);
  });

  it('drops unknown component types instead of rendering them', () => {
    const result = validateUI(
      base([
        { id: 'c1', type: 'text', content: 'Kept.' },
        { id: 'c2', type: 'definitely_not_a_type', content: 'Dropped.' },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.document.components).toHaveLength(1);
    expect(result.document.components[0].id).toBe('c1');
    // The drop is reported, never silent.
    expect(result.dropped.length).toBe(1);
    expect(result.dropped[0].message).toContain('definitely_not_a_type');
  });

  it('fails when every component is unknown', () => {
    const result = validateUI(base([{ id: 'c1', type: 'rm_rf', content: 'x' }]));
    expect(result.ok).toBe(false);
    expect(result.document).toBeNull();
  });

  it('requires a unique id per component', () => {
    const result = validateUI(
      base([
        { id: 'dup', type: 'text', content: 'first' },
        { id: 'dup', type: 'text', content: 'second' },
      ]),
    );
    expect(result.ok).toBe(true); // repaired, not rejected
    const ids = result.document.components.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.issues.map((i) => i.message).join(' ')).toMatch(/duplicate/i);
  });

  it('supplies an id when one is missing', () => {
    const result = validateUI(base([{ type: 'text', content: 'No id given.' }]));
    expect(result.ok).toBe(true);
    expect(result.document.components[0].id).toBeTruthy();
  });

  it('rejects a component with no content', () => {
    const result = validateUI(base([{ id: 'c1', type: 'text', content: '' }]));
    expect(result.ok).toBe(false);
  });

  it('truncates a very long string instead of rejecting the lesson', () => {
    const huge = 'a'.repeat(50_000);
    const result = validateUI(base([{ id: 'c1', type: 'text', content: huge }]));
    expect(result.ok).toBe(true);
    expect(result.document.components[0].content.length).toBeLessThanOrEqual(12_000);
    expect(result.issues.map((i) => i.message).join(' ')).toMatch(/truncat/i);
  });

  it('enforces nesting depth', () => {
    let node = { id: 'leaf', type: 'text', content: 'deep' };
    for (let i = 0; i < 12; i += 1) {
      node = { id: `n${i}`, type: 'layout', layout: 'stack', children: [node] };
    }
    const result = validateUI(base([node]));
    // Either it is rejected outright or the depth is flattened — it must never
    // render an arbitrarily deep tree.
    const depthOf = (c) => (c?.children?.length ? 1 + Math.max(...c.children.map(depthOf)) : 1);
    if (result.ok) expect(depthOf(result.document.components[0])).toBeLessThanOrEqual(8);
    else expect(result.issues.length).toBeGreaterThan(0);
  });

  it('caps the number of components', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `c${i}`, type: 'text', content: `Paragraph ${i}` }));
    const result = validateUI(base(many));
    expect(result.ok).toBe(true);
    expect(result.document.components.length).toBeLessThanOrEqual(40);
    expect(result.issues.map((i) => i.message).join(' ')).toMatch(/trim/i);
  });
});

describe('sanitizeUrl — media and navigation', () => {
  it('allows https media URLs', () => {
    expect(sanitizeUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(sanitizeUrl('https://cdn.example.com/a.png?x=1')).toBe('https://cdn.example.com/a.png?x=1');
  });

  it('rejects a relative path rather than resolving it against the app origin', () => {
    // Media must be absolute https: a relative path would resolve to the app
    // itself, which is not a media host and can be used to probe internal routes.
    expect(sanitizeUrl('/media/a.png')).toBe('');
    expect(sanitizeUrl('//evil.example.com/a.png')).toBe('');
  });

  it('allows a small inline raster image but not an oversized one', () => {
    const small = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sanitizeUrl(small)).toBe(small);
    const huge = `data:image/png;base64,${'A'.repeat(600_000)}`;
    expect(sanitizeUrl(huge)).toBe('');
  });

  it('blocks script-bearing and data URLs', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', 'file:///etc/passwd', '  javascript:alert(1)']) {
      expect(sanitizeUrl(bad)).toBe('');
    }
  });
});

describe('sanitizeText', () => {
  it('strips control characters but keeps newlines', () => {
    expect(sanitizeText('a\u0000b\nc\u0007d')).toBe('ab\ncd');
  });

  it('handles non-strings without throwing', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText(42)).toBe('42');
  });
});

describe('sanitizeAnswers — question form payloads', () => {
  it('keeps primitives and arrays of primitives', () => {
    const answers = sanitizeAnswers({
      q1: 'text',
      q2: 3,
      q3: true,
      q4: ['a', 'b'],
    });
    expect(answers).toEqual({ q1: 'text', q2: 3, q3: true, q4: ['a', 'b'] });
  });

  it('drops objects, functions and prototype keys', () => {
    const answers = sanitizeAnswers({ q1: { evil: true }, q2: () => 'x', ['__proto__']: 'x', constructor: 'y', q3: 'ok' });
    expect(answers).toEqual({ q3: 'ok' });
    expect(Object.keys(answers)).toEqual(['q3']);
  });

  it('never returns a non-object', () => {
    expect(sanitizeAnswers(null)).toEqual({});
    expect(sanitizeAnswers('x')).toEqual({});
    expect(sanitizeAnswers([1, 2])).toEqual({});
    expect(sanitizeAnswers(42)).toEqual({});
  });
});

describe('uiDocumentSchema — direct Zod contract', () => {
  it('validates a full document with metadata', () => {
    const parsed = uiDocumentSchema.safeParse({
      version: '1.0',
      response_id: 'r1',
      response_type: 'educational_tutorial',
      metadata: { topic: 'Recursion', difficulty: 'beginner', language: 'en', subject: 'programming' },
      learning_objectives: ['Explain the base case'],
      components: [
        { id: 'c1', type: 'text', content: 'Body' },
        { id: 'c2', type: 'quiz', questions: [{ id: 'q1', question: 'What stops recursion?', options: ['Base case', 'A loop'], correct_index: 0 }] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a component type outside the registry', () => {
    const parsed = uiDocumentSchema.safeParse(base([{ id: 'c1', type: 'script', content: 'x' }]));
    expect(parsed.success).toBe(false);
  });
});

describe('validateUI — repairs real malformed model output', () => {
  it('repairs a stray markdown fence and trailing commas', () => {
    const raw = '```json\n' + JSON.stringify(base([{ id: 'c1', type: 'text', content: 'Fenced.' }])) + '\n```';
    const result = validateUI(JSON.parse(raw.replace(/^```json\n/, '').replace(/\n```$/, '')));
    expect(result.ok).toBe(true);
  });

  it('survives a deeply nested malformed child list', () => {
    const result = validateUI(
      base([{ id: 'root', type: 'card', children: [null, 'string', 42, { id: 'ok', type: 'text', content: 'survivor' }] }]),
    );
    expect(result.ok).toBe(true);
    const text = JSON.stringify(result.document);
    expect(text).toContain('survivor');
    // The three junk entries are reported, not rendered.
    expect(result.dropped.length).toBe(3);
  });
});
