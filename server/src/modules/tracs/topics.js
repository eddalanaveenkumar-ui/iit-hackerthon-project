import { z } from 'zod';
import { badRequest } from '../../utils/errors.js';

/**
 * TRACS — the syllabus conversation
 * =================================
 *
 * A learner uploads a syllabus once. From then on "tracs" is a chat with
 * exactly two commands:
 *
 *   /test   assessment, one question at a time, each chosen from the answer
 *           that came before it
 *   /learn  an explanation *with its renderings*, then checking questions and
 *           a re-teach when the checks are missed
 *
 * This file holds the parts that are pure: turning extracted syllabus text into
 * topics, deciding which topic to ask about next, and the review scheduling.
 * The routes file does the I/O, and the engine file does the teaching.
 *
 * Why topics are heuristic, not model-authored
 * --------------------------------------------
 * The syllabus is the *anchor* for a whole session: if topic extraction drifts,
 * every question afterwards is about something the learner did not upload. So
 * topics are derived deterministically from the document's own structure
 * (headings, numbered units, bulleted concepts) and the model is only asked to
 * phrase questions about them. A model may still propose topics, but they are
 * merged into — never substituted for — the parsed ones.
 */

export const MASTERY = Object.freeze({
  unseen: 0,
  weak: 1,
  shaky: 2,
  solid: 3,
  mastered: 4,
});

/** A topic is a syllabus heading and what the syllabus said under it. */
export const topicSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  summary: z.string().max(1200).default(''),
  keywords: z.array(z.string().max(60)).max(20).default([]),
  unit: z.string().max(200).default(''),
  // Filled in as the learner works: never trusted from the model.
  attempts: z.number().int().min(0).default(0),
  correct: z.number().int().min(0).default(0),
  mastery: z.number().int().min(0).max(4).default(0),
  lastSeenAt: z.string().nullable().default(null),
  nextReviewAt: z.string().nullable().default(null),
});

const NOISE = /^(syllabus|course outline|course description|contents|table of contents|module|unit|chapter|week|overview|introduction to the course|assessment|grading|references|bibliography|appendix)$/i;

/** Words that carry no topic signal when deciding what a line is about. */
const STOPWORDS = new Set(
  'a an the and or but of to in on at for with by from as is are was were be been being this that these those it its into about after before during under over between within without using use used can may will shall should must not no all any each other such more most less least than then there their they you your we our i he she his her them'.split(/\s+/),
);

function titleCase(text) {
  return text
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(And|Or|Of|To|In|On|At|For|The|A|An|With|By)\b/g, (w) => w.toLowerCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

/**
 * Strip the scaffolding a syllabus paragraph carries — bullets, numbering,
 * week markers — so what remains is the concept itself.
 */
function cleanHeading(line) {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\s*[-*•+]\s+/, '')
    .replace(/^\s*\d+(\.\d+)*[.)]?\s+/, '')
    .replace(/^\s*(week|module|unit|chapter|topic|lesson)\s*\d+\s*[:.-]?\s*/i, '')
    .replace(/\s*[|–—-]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull topics out of extracted syllabus text.
 *
 * Three signals, in descending order of confidence:
 *   1. markdown headings (`## Unit 1: Loops`) — explicit structure;
 *   2. numbered or capitalised lines that look like unit titles;
 *   3. a bulleted concept list under a heading.
 *
 * Text that matches none of these still yields topics: a plain prose syllabus
 * is split on its sentences and the most concept-like become topics. A syllabus
 * we cannot read is worse than a rough one.
 */
export function extractTopics(text, { limit = 40 } = {}) {
  const raw = String(text || '').replace(/\r\n?/g, '\n');
  if (!raw.trim()) return [];

  const lines = raw.split('\n');
  const topics = [];
  let currentUnit = '';

  const push = (title, { summary = '', keywords = [], unit = currentUnit } = {}) => {
    const clean = cleanHeading(String(title || ''));
    if (!clean || clean.length < 3 || clean.length > 120) return;
    if (NOISE.test(clean)) return;
    if (/^\d+$/.test(clean)) return;
    // A heading of one or two words that is all stopwords is not a topic.
    const words = clean.split(/\s+/);
    if (words.length === 1 && STOPWORDS.has(words[0].toLowerCase())) return;
    if (topics.some((t) => t.title.toLowerCase() === clean.toLowerCase())) return;
    topics.push({
      id: `t${topics.length + 1}`,
      title: titleCase(clean),
      summary: String(summary || '').slice(0, 1200),
      keywords: [...new Set(keywords.map((k) => String(k).toLowerCase().slice(0, 60)))].slice(0, 20),
      unit: String(unit || '').slice(0, 200),
    });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 1. explicit markdown heading
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const looksLikeUnit = /^(week|module|unit|chapter|part)\b/i.test(heading[1].trim());
      // A unit heading names the container the following concepts belong to.
      // The unit itself is not a topic — "Unit 2: Data Structures" is a label,
      // not something to ask a question about — but its concepts are, and they
      // must carry the unit so the sidebar can group them.
      if (looksLikeUnit) {
        currentUnit = cleanHeading(heading[1]);
        continue;
      }
      const body = [];
      while (index + 1 < lines.length && !/^#{1,6}\s+/.test(lines[index + 1].trim()) && body.length < 6) {
        const next = lines[index + 1].trim();
        if (next) body.push(next.replace(/^[-*•+]\s+/, ''));
        index += 1;
      }
      const keywords = body.join(' ').toLowerCase().match(/[a-z][a-z+#.-]{2,}/g) || [];
      push(heading[1], { summary: body.join(' ').slice(0, 1200), keywords: keywords.filter((k) => !STOPWORDS.has(k)).slice(0, 8), unit: currentUnit });
      continue;
    }

    // 2. a "Unit 1: …" / "Week 3 — …" style line, with or without the marker
    const unitLine = trimmed.match(/^(?:week|module|unit|chapter|part|topic|lesson)\s*(\d+[a-z]?)\s*[:.\-–]?\s*(.*)$/i);
    if (unitLine) {
      const title = unitLine[2] || unitLine[1];
      if (unitLine[2]) push(title, { unit: cleanHeading(trimmed) });
      else currentUnit = cleanHeading(trimmed);
      continue;
    }

    // 3. a bulleted concept
    const bullet = trimmed.match(/^[-*•+]\s+(.+)$/);
    if (bullet) {
      const text = cleanHeading(bullet[1]);
      // A long bullet is a sentence, not a topic name.
      if (text.split(/\s+/).length <= 9) push(text);
      continue;
    }

    // 4. a short, title-cased line on its own — the common shape of a
    //    pasted syllabus where structure survives but markdown does not.
    const words = trimmed.split(/\s+/);
    const looksLikeTitle = words.length <= 8
      && !/[.!?;]$/.test(trimmed)
      && /^[A-Z0-9]/.test(trimmed)
      && (trimmed === trimmed.toUpperCase() || /^[A-Z][a-z]/.test(trimmed));
    if (looksLikeTitle) push(trimmed);
  }

  // 5. Nothing structural survived: fall back to the prose itself. Split on
  //    sentence boundaries and keep the ones that read like a concept.
  if (topics.length < 3) {
    const sentences = raw
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 12 && s.length < 200);
    for (const sentence of sentences) {
      if (topics.length >= limit) break;
      const words = sentence.replace(/[.!?]$/, '').split(/\s+/);
      if (words.length < 2 || words.length > 12) continue;
      push(words.slice(0, 12).join(' '));
    }
  }

  return topics.slice(0, limit);
}

/**
 * Which topic to ask about next.
 *
 * The rule the brief asks for is "the next question is chosen from the answer
 * the user just gave". That is expressed here as a score over the learner's
 * history, with the *last answered topic* steering:
 *
 *   - a topic just answered **wrongly** is re-asked soon (with a different
 *     angle, handled by the engine) — a wrong answer means the idea is not
 *     settled, not that the lesson should move on;
 *   - a topic answered **correctly** is pushed out to its review date, so the
 *     session progresses and does not drill what is already known;
 *   - a **cross-link** to a prerequisite of the current topic is preferred when
 *     a wrong answer suggests an earlier idea is missing;
 *   - anything never seen, or overdue for review, outranks everything.
 *
 * @returns {{ topic: object|null, reason: string }}
 */
export function chooseNextTopic(topics, { lastTopicId = null, lastVerdict = null, now = new Date() } = {}) {
  const list = (topics || []).filter((t) => t && t.title);
  if (!list.length) return { topic: null, reason: 'empty_syllabus' };

  const last = lastTopicId ? list.find((t) => t.id === lastTopicId) : null;
  const isDue = (t) => !t.nextReviewAt || new Date(t.nextReviewAt) <= now;

  // A wrong answer: re-ask the same topic. The engine phrases it differently and
  // moves to an easier angle, so this is not a repeat of the same question.
  if (last && lastVerdict && lastVerdict !== 'correct' && lastVerdict !== 'not_graded') {
    const attempts = (last.attempts || 0) + 1;
    // Three misses in a row means the *explanation* is the problem, and the
    // caller is told to send the learner to /learn instead of a fourth question.
    if (attempts >= 3) {
      return { topic: last, reason: 'needs_teaching' };
    }
    return { topic: last, reason: 'retry_after_incorrect' };
  }

  // Correct: prefer something that has never been answered correctly. `attempts`
  // is the wrong signal — it counts retries on the *same* topic, so a topic that
  // was answered right on the first try would look "seen" and a topic answered
  // wrong once would look seen too. What matters is whether the learner has
  // demonstrated it.
  const unseen = list.filter((t) => !t.correct && t.id !== lastTopicId);
  if (unseen.length) return { topic: unseen[0], reason: 'first_exposure' };

  const due = list.filter(isDue).sort((a, b) => (a.mastery || 0) - (b.mastery || 0));
  if (due.length) return { topic: due[0], reason: 'review_due' };

  // Nothing due: the weakest topic, so a strong learner is still stretched and
  // a weak one still gets support.
  const weakest = [...list].sort((a, b) => (a.mastery || 0) - (b.mastery || 0) || (a.correct || 0) - (b.correct || 0))[0];
  if (weakest && (weakest.mastery || 0) < MASTERY.mastered) return { topic: weakest, reason: 'weakest_topic' };

  // Everything is mastered — say so rather than inventing another question.
  return { topic: null, reason: 'all_mastered' };
}

/**
 * Update a topic's history from one graded answer.
 *
 * Mastery moves one step per answer in the direction of the verdict, with a
 * correct answer needing two hits to reach `solid` from `weak`. A retry
 * schedule follows the step: weak topics come back in a few minutes, solid ones
 * in hours, mastered ones not at all.
 */
export function applyAnswerToTopic(topic, { verdict, now = new Date() } = {}) {
  const next = { ...topic };
  next.attempts = (next.attempts || 0) + 1;
  next.lastSeenAt = now.toISOString();

  const correct = verdict === 'correct';
  const partly = verdict === 'partly_correct';
  if (correct) next.correct = (next.correct || 0) + 1;

  const current = next.mastery || 0;
  if (correct) next.mastery = Math.min(MASTERY.mastered, current + 1);
  else if (partly) next.mastery = Math.max(MASTERY.unseen, current); // hold
  else next.mastery = Math.max(MASTERY.unseen, current - 1);

  // Spacing schedule, in minutes.
  const delayMinutes = correct
    ? [10, 60, 24 * 60, 3 * 24 * 60][Math.min(next.mastery, 3)]
    : 2;
  next.nextReviewAt = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
  return next;
}

/** The learner-facing mastery word for a topic, used by the sidebar. */
export function masteryLabel(topic) {
  const words = ['Not started', 'Needs work', 'Getting there', 'Solid', 'Mastered'];
  return words[Math.min(topic?.mastery || 0, 4)];
}

/* -------------------------------------------------------------------------- */
/* request schemas                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One chat turn. The command is a closed enum — `/test` and `/learn` are the
 * only two things this endpoint accepts, and a free-text message is rejected
 * rather than being guessed at.
 */
export const turnSchema = z.object({
  command: z.enum(['test', 'learn']),
  // Free text is allowed only as the *answer* to the question just asked, and
  // it is matched against the open question server-side.
  message: z.string().max(8000).optional().default(''),
  // The id of the question being answered, so a stale tab cannot answer a
  // question that has since moved on.
  question_id: z.string().max(80).optional().nullable(),
  topic_id: z.string().max(64).optional().nullable(),
  answer: z
    .union([
      z.string().max(20_000),
      z.number().finite(),
      z.boolean(),
      z.array(z.string().max(2000)).max(50),
      z.null(),
    ])
    .optional(),
});

export const uploadSchema = z.object({
  title: z.string().max(200).optional(),
  // A learner may paste the syllabus instead of uploading a file.
  text: z.string().max(400_000).optional(),
});

/** Reject the request early if it cannot possibly be one of the two commands. */
export function parseCommand(input) {
  const value = String(input || '').trim();
  if (!value) throw badRequest('Type /test or /learn to begin.');
  // The command must be the whole first token: `/test/learn` is not `/test`.
  const match = value.match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (!match) throw badRequest('Only /test and /learn are available.');
  const name = match[1].toLowerCase();
  if (name !== 'test' && name !== 'learn') throw badRequest('Only /test and /learn are available.');
  return { command: name, rest: String(match[2] || '').trim() };
}
