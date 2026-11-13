import { api } from './api';

/**
 * TRACS CLIENT
 * ============
 *
 * Three calls, and one deliberate absence: there is no "send any message"
 * function. A turn must name one of the two commands, which is enforced both
 * here and by the server's closed enum.
 */

export async function uploadTracsSyllabus({ file, text, title } = {}) {
  const form = new FormData();
  if (file) form.append('file', file);
  if (text?.trim()) form.append('text', text);
  if (title?.trim()) form.append('title', title);
  return api('/tracs/syllabus', { method: 'POST', body: form });
}

export async function listTracsSessions() {
  return api('/tracs');
}

export async function fetchTracsSession(id) {
  return api(`/tracs/${encodeURIComponent(id)}`);
}

export async function deleteTracsSession(id) {
  return api(`/tracs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * One chat turn.
 *
 * `command` is `test` or `learn` — nothing else reaches the server, and the
 * server refuses anything else even if a client sent it.
 *
 * @param {string} sessionId
 * @param {{ command: 'test'|'learn', answer?: any, question_id?: string, topic_id?: string }} turn
 */
export async function sendTracsTurn(sessionId, { command, answer, question_id, topic_id } = {}) {
  if (command !== 'test' && command !== 'learn') {
    throw new Error('Only /test and /learn are available here.');
  }
  return api(`/tracs/${encodeURIComponent(sessionId)}/turn`, {
    method: 'POST',
    body: {
      command,
      ...(answer !== undefined ? { answer } : {}),
      ...(question_id ? { question_id } : {}),
      ...(topic_id ? { topic_id } : {}),
    },
  });
}

export const TRACS_COMMANDS = Object.freeze(['/test', '/learn']);
