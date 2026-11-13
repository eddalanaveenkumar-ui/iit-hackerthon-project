import { describe, expect, it } from 'vitest';
import { safeMessageText, looksLikeSerialisedPayload } from '../lib/messageText';

/**
 * THE REPORTED PRODUCTION BUG
 * ===========================
 *
 * A chat bubble displayed the tutor's raw JSON:
 *
 *   { "reply": "Great! You have Python installed…", "scaffoldingLevel": … }
 *
 * The server now normalises replies before storing them, but a message written
 * before that fix can still be in the database, and the bubble must cope. These
 * tests pin the display behaviour: a serialised payload is never shown, and its
 * prose is recovered instead.
 */

const BUG_PAYLOAD = `{
  "reply": "Great! You have Python installed and can run scripts. Now we'll write your first program.",
  "scaffoldingLevel": "supported",
  "hints": [{ "level": "nudge", "text": "Remember print()." }],
  "citations": [],
  "misconceptionObserved": null,
  "nextPrompt": "Modify the program to print your name.",
  "assessmentRecommendation": { "discount": 0.2, "recommend": false, "kind": "quiz", "reason": "Not enough evidence yet." },
  "difficultyShift": "same",
  "followUpQuestion": "What do you think print() does?",
  "visuals": []
}`;

describe('looksLikeSerialisedPayload', () => {
  it('recognises the exact payload from the bug report', () => {
    expect(looksLikeSerialisedPayload(BUG_PAYLOAD)).toBe(true);
  });

  it('does not mistake prose for JSON', () => {
    expect(looksLikeSerialisedPayload('A base case stops the recursion.')).toBe(false);
    expect(looksLikeSerialisedPayload('Why does {this} fail?')).toBe(false);
    expect(looksLikeSerialisedPayload('')).toBe(false);
  });

  it('does not mistake a fenced code sample for a payload', () => {
    expect(looksLikeSerialisedPayload('```json\n{ "a": 1 }\n```')).toBe(false);
  });
});

describe('safeMessageText', () => {
  it('extracts the reply and never shows the JSON', () => {
    const text = safeMessageText(BUG_PAYLOAD);
    expect(text).toBe("Great! You have Python installed and can run scripts. Now we'll write your first program.");
    expect(text).not.toContain('scaffoldingLevel');
    expect(text).not.toContain('{');
  });

  it('recovers prose from a payload with a trailing comma', () => {
    const text = safeMessageText('{ "reply": "Use a for loop.", "hints": [], }');
    expect(text).toBe('Use a for loop.');
  });

  it('uses the first text component when the payload is a lesson', () => {
    const text = safeMessageText(JSON.stringify({
      components: [
        { id: 'c1', type: 'layout', children: [{ id: 'c2', type: 'text', content: 'A lesson body.' }] },
      ],
    }));
    expect(text).toBe('A lesson body.');
  });

  it('degrades to a readable sentence when a payload cannot be parsed', () => {
    const text = safeMessageText('{ "reply": "unterminated');
    expect(text).not.toContain('"reply"');
    expect(text.length).toBeGreaterThan(10);
  });

  it('passes ordinary prose through untouched', () => {
    const prose = 'Recursion is when a function calls itself. **Bold** stays markdown.';
    expect(safeMessageText(prose)).toBe(prose);
  });

  it('never throws on odd input', () => {
    for (const value of [null, undefined, 0, false, [], {}]) {
      expect(() => safeMessageText(value)).not.toThrow();
    }
  });
});
