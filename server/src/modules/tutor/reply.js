import { extractJson } from '../ai/orchestrator.js';
import { authorTutorial } from '../ai/ui/teaching-engine.js';
import { parseUiDocument } from '../ai/ui/protocol.js';
import { documentToPlainText } from '../learning/lessons.js';

/**
 * REPLY NORMALISATION — never show JSON to a student
 * ==================================================
 *
 * Reported in production: a chat bubble contained the tutor's raw JSON
 * (`{ "reply": "Great! …", "scaffoldingLevel": "supported", … }`).
 *
 * The cause was a silent, one-line degradation. `runJsonTask` returns
 * `parsed ?? res.text`; when the model's output could not be parsed — a fence
 * inside a fence, an unescaped quote, a truncated object — the *raw text* was
 * returned and the route did:
 *
 *     const candidateReply = typeof tutorData === 'string' ? tutorData : tutorData?.reply;
 *
 * A string was accepted as a reply verbatim. Whatever had failed to parse was
 * therefore displayed to the learner, JSON braces and all.
 *
 * This module makes that impossible:
 *
 *   - a string is only a reply if it is *not* a serialised object or array;
 *   - a serialised object is parsed (tolerantly) and its `reply` extracted;
 *   - a document with `components` becomes a rendered lesson (`meta.ui`) with
 *     plain text as its fallback content;
 *   - anything else is replaced with a human sentence — never passed through.
 *
 * Everything here is pure, so it is covered directly by tests.
 */

const FALLBACK_REPLY = 'Let me put that another way — which part feels unclear?';

/** Does this text look like a serialised JSON value rather than prose? */
export function looksLikeJson(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return false;
  if (!/^[[{]/.test(trimmed)) return false;
  // A teaching reply may legitimately start with "{" only inside a code sample,
  // which is fenced. A bare opening brace with a quoted key is a JSON object.
  return /^\{[\s\S]*["'][A-Za-z_][\w-]*["']\s*:/.test(trimmed) || /^\[\s*\{/.test(trimmed);
}

/**
 * Parse JSON that a strict parser rejected — the common failures are a trailing
 * comma, a stray markdown fence, and text before/after the object. This is
 * deliberately not a JSON5 parser: it repairs punctuation, nothing else.
 */
export function tolerantJsonParse(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const candidates = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(raw);

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      /* keep trying */
    }
    // Trim to the outermost balanced object/array before repairing punctuation.
    const start = trimmed.search(/[{[]/);
    if (start === -1) continue;
    const open = trimmed[start];
    const close = open === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(close);
    if (end <= start) continue;
    let slice = trimmed.slice(start, end + 1);
    slice = slice
      .replace(/,\s*([}\]])/g, '$1') // trailing commas
      .replace(/[\u201C\u201D]/g, '"') // smart quotes around keys/values
      .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":'); // unquoted keys
    try {
      return JSON.parse(slice);
    } catch {
      /* give up on this candidate */
    }
  }
  return null;
}

/** Coerce anything that was meant to be a reply into plain prose, or ''. */
function asReplyText(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (looksLikeJson(trimmed)) return '';
  return trimmed;
}

/**
 * Normalise a tutoring model's output into something a student can read.
 *
 * @param {unknown} data  the parsed (or unparsed) model output
 * @param {object} [context]
 * @param {string} [context.question]
 * @param {object} [context.concept]
 * @param {string} [context.level]
 * @param {string} [context.subject]
 * @param {string} [context.responseId]
 * @returns {{ reply: string, ui: object|null, data: object|null, repaired: boolean }}
 */
export function normaliseTutorReply(data, context = {}) {
  let value = data;
  let repaired = false;

  // 1. A string might be prose, or it might be the JSON we failed to parse.
  if (typeof value === 'string') {
    const parsed = extractJson(value) || tolerantJsonParse(value);
    if (parsed && typeof parsed === 'object') {
      value = parsed;
      repaired = true;
    } else {
      const prose = asReplyText(value);
      return { reply: prose || FALLBACK_REPLY, ui: null, data: null, repaired: false, unusable: !prose };
    }
  }

  if (!value || typeof value !== 'object') {
    return { reply: FALLBACK_REPLY, ui: null, data: null, repaired, unusable: true };
  }

  // 2. A UI document is a lesson: validate it, render it, and derive the prose
  //    from its components so the transcript and the chat bubble agree.
  if (Array.isArray(value.components) && value.components.length) {
    const direct = parseUiDocument({ version: '1.0', response_id: `tutor_${Date.now().toString(36)}`, response_type: 'educational_tutorial', ...value });
    const authored = direct.ok
      ? direct
      : authorTutorial({ raw: value, question: context.question || '', concept: context.concept || null, level: context.level || '', subject: context.subject || '' });
    if (authored.document) {
      const reply = asReplyText(value.reply) || documentToPlainText(authored.document);
      return { reply, ui: authored.document, data: value, repaired: true };
    }
  }

  // 3. Normal shape: `reply` plus optional visuals/hints.
  const reply = asReplyText(value.reply) || asReplyText(value.content) || asReplyText(value.text);
  if (reply) return { reply, ui: null, data: value, repaired };

  // 4. The object parsed but has no usable prose. If it carries a UI-ish payload
  //    we can still build a lesson from it.
  if (Array.isArray(value.components) || value.response_type) {
    const authored = authorTutorial({ raw: value, question: context.question || '', concept: context.concept || null, level: context.level || '' });
    if (authored.document) {
      return { reply: documentToPlainText(authored.document), ui: authored.document, data: value, repaired: true };
    }
  }

  return { reply: FALLBACK_REPLY, ui: null, data: value, repaired, unusable: true };
}

/** Text that must never reach a chat bubble, for the client-side guard too. */
export function isSerialisedPayload(text) {
  return looksLikeJson(text);
}

export { FALLBACK_REPLY };
