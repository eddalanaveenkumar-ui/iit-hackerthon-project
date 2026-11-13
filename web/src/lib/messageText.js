/**
 * CHAT MESSAGE NORMALISATION (client guard)
 * =========================================
 *
 * The server normalises tutor replies (`server/src/modules/tutor/reply.js`), but
 * a stored message written before that fix — or one written by a future consumer
 * of the same table — could still contain a serialised payload. A student must
 * never see `{"reply": "…", "scaffoldingLevel": …}` in a bubble, so the last line
 * of defence lives here: if a message body looks like JSON, extract its `reply`
 * (or its first text component) and show that instead.
 *
 * This is display logic only. It does not execute, evaluate or trust anything.
 */

const JSON_START = /^\s*\{[\s\S]*["'][A-Za-z_][\w-]*["']\s*:/;

export function looksLikeSerialisedPayload(text) {
  const value = String(text ?? '').trim();
  if (!value) return false;
  if (!JSON_START.test(value)) return false;
  // Guard against a legitimate teaching snippet: a real code sample is fenced.
  return !value.startsWith('```');
}

function extractFromPayload(text) {
  const value = String(text ?? '').trim();
  const candidates = [value];
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.unshift(fenced[1]);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function firstTextComponent(components = []) {
  for (const component of components) {
    if (component?.type === 'text' && component.content) return component.content;
    if (component?.type === 'learning') {
      const parts = [];
      if (component.objectives?.length) parts.push(component.objectives.join(' · '));
      if (component.summary) parts.push(component.summary);
      if (parts.length) return parts.join('\n\n');
    }
    const nested = firstTextComponent(component?.children || []);
    if (nested) return nested;
  }
  return '';
}

/**
 * @param {string} content
 * @returns {string} prose safe to render in a bubble
 */
export function safeMessageText(content) {
  if (!looksLikeSerialisedPayload(content)) return String(content ?? '');
  const parsed = extractFromPayload(content);
  if (!parsed) return 'The tutor sent a response this app could not read. Try asking again.';
  if (typeof parsed.reply === 'string' && parsed.reply.trim()) return parsed.reply.trim();
  if (typeof parsed.content === 'string' && parsed.content.trim()) return parsed.content.trim();
  if (Array.isArray(parsed.components)) {
    const text = firstTextComponent(parsed.components);
    if (text) return text;
  }
  return 'The tutor sent a structured response that has to be opened as a lesson.';
}
