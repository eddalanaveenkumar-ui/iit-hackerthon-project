import { getDb } from '../../db/index.js';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { analyseQuestion, authorTutorial, buildLocalTutorial } from '../ai/ui/teaching-engine.js';
import { parseUiDocument, fallbackTextDocument, UI_LIMITS } from '../ai/ui/protocol.js';
import { runJsonTask } from '../ai/orchestrator.js';
import { prompts } from '../ai/prompts.js';
import { isFeatureEnabled } from '../ai/config-store.js';
import { getOrCreateProfile } from '../intelligence/profile.js';
import { getOpenGaps } from '../intelligence/gap-engine.js';
import { retrieveContext, buildSyllabusContext } from '../tutor/retrieval.js';
import { toOid } from '../classrooms/access.js';
import { badRequest, notFound } from '../../utils/errors.js';

/**
 * LESSON AUTHORING SERVICE
 * ========================
 *
 * The single place where "the AI writes a lesson" happens, for both the
 * free-form tutor surface and the classroom-scoped one. It owns:
 *
 *  - the teaching workflow (analysis → strategy → authoring → validation);
 *  - structured output with a **deterministic repair and fallback ladder**
 *    (strict parse → repair-dropping-bad-components → full local tutorial);
 *  - persistence of the authored document so a lesson survives a refresh and can
 *    be re-rendered without another model call;
 *  - the learning context handed to the model (syllabus, gaps, level, profile).
 *
 * Authorization is deliberately NOT handled here: callers have already resolved
 * the classroom membership. This module is concerned with teaching.
 */

const RESPONSE_TYPES = ['educational_tutorial', 'concept_check', 'question_form', 'code_practice', 'assessment', 'progress_summary', 'clarification'];

const generateInput = z.object({
  prompt: z.string().trim().min(1).max(4000),
  mode: z.enum(['learn', 'teach', 'test', 'practise', 'continue']).default('learn'),
  classroomId: z.string().optional().nullable(),
  conceptId: z.string().optional().nullable(),
  sessionId: z.string().optional().nullable(),
  level: z.enum(['beginner', 'developing', 'proficient', 'advanced']).optional(),
  subject: z.string().max(80).optional(),
  language: z.string().max(12).optional(),
  forceLocal: z.boolean().optional(),
});

function newResponseId() {
  return `ui_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

/** Extract the text a document can be represented by when rendered in chat. */
export function documentToPlainText(document) {
  const lines = [];
  const walk = (components, depth = 0) => {
    for (const c of components || []) {
      const pad = '';
      switch (c.type) {
        case 'text': lines.push(`${pad}${c.content}`); break;
        case 'learning':
          if (c.objectives?.length) lines.push(`**Objectives**\n${c.objectives.map((o) => `- ${o}`).join('\n')}`);
          if (c.analogy) lines.push(`**Analogy.** ${c.analogy}`);
          if (c.summary) lines.push(`**Summary.** ${c.summary}`);
          break;
        case 'card': lines.push(`${pad}**${c.title || ''}**${c.body ? ` — ${c.body}` : ''}`); break;
        case 'code_editor': lines.push(`\`\`\`${c.language || ''}\n${c.starter_code || ''}\n\`\`\``); break;
        case 'question_form': lines.push(`**${c.title || 'Questions'}** — ${c.questions.length} question${c.questions.length > 1 ? 's' : ''} below.`); break;
        case 'quiz': lines.push(`**${c.title || 'Quiz'}** — ${c.questions.length} question${c.questions.length > 1 ? 's' : ''}.`); break;
        case 'layout': walk(c.children, depth + 1); break;
        case 'tabs': c.tabs?.forEach((t) => walk(t.children, depth + 1)); break;
        case 'accordion': c.items?.forEach((i) => walk(i.children, depth + 1)); break;
        default: break;
      }
    }
  };
  walk(document.components);
  return lines.filter(Boolean).join('\n\n').slice(0, 8000) || 'Your lesson is ready below.';
}

/**
 * Build the teaching context for a request: syllabus, gaps, level, retrieval.
 * Unknown concept / classroom ids degrade to null rather than throwing — a
 * learner asking "teach me recursion" outside a classroom must still get a lesson.
 */
export async function buildTeachingContext({ userId, classroomId, conceptId, prompt, level }) {
  const db = getDb();
  const context = { concept: null, classroom: null, unit: null, subject: null, profile: null, openGaps: [], syllabusContext: '', retrieved: [] };

  if (classroomId) {
    context.classroom = await db.collection('classrooms').findOne({ _id: toOid(classroomId) }).catch(() => null);
    if (context.classroom) {
      context.profile = await getOrCreateProfile(userId, context.classroom._id).catch(() => null);
      context.openGaps = await getOpenGaps(userId, context.classroom._id, { conceptId: conceptId || undefined }).catch(() => []);
    }
  }
  if (conceptId) {
    const concept = await db
      .collection('syllabus_units')
      .findOne({ _id: toOid(conceptId), type: 'concept', ...(context.classroom ? { classroomId: context.classroom._id } : {}) })
      .catch(() => null);
    if (concept) {
      context.concept = concept;
      context.unit = concept.parentId ? await db.collection('syllabus_units').findOne({ _id: concept.parentId }) : null;
      context.subject = concept.subjectId ? await db.collection('syllabus_units').findOne({ _id: concept.subjectId }) : null;
      if (context.classroom) {
        const retrieved = await retrieveContext({
          classroomId: context.classroom._id,
          concept: { ...concept, id: concept._id },
          query: prompt,
        }).catch(() => ({ chunks: [] }));
        context.retrieved = retrieved.chunks || [];
        context.syllabusContext = buildSyllabusContext({ concept, unit: context.unit, subject: context.subject, retrieved: context.retrieved });
      }
    }
  }

  const analysis = analyseQuestion({
    question: prompt,
    concept: context.concept,
    studentLevel: level || context.profile?.knowledgeLevel || '',
    subject: context.subject?.name || '',
    profile: context.profile,
  });
  context.analysis = analysis;
  return context;
}

function modelContextFor(context) {
  return {
    concept: context.concept
      ? {
          ...context.concept,
          unitName: context.unit?.name,
          subjectName: context.subject?.name || context.analysis.subject,
          subtopics: context.concept.subtopics || [],
        }
      : { name: context.analysis.conceptName, description: '', objectives: [], keywords: [] },
    syllabusContext: context.syllabusContext,
    retrieved: context.retrieved,
    profile: context.profile,
    openGaps: context.openGaps,
    adaptiveLevel: context.analysis.level,
  };
}

/**
 * Generate (or continue) a lesson document.
 *
 * @returns {{ document, source, analysis, meta, concept, classroom }}
 */
export async function generateLesson({ userId, input }) {
  const data = generateInput.parse(input);
  const responseId = newResponseId();
  const context = await buildTeachingContext({
    userId,
    classroomId: data.classroomId || null,
    conceptId: data.conceptId || null,
    prompt: data.prompt,
    level: data.level,
  });

  const enabled = await isFeatureEnabled('dynamic_ui');
  const localOnly = data.forceLocal || !enabled;

  let document = null;
  let source = 'local';
  let meta = { provider: 'local', model: 'local-analyser', simulated: true };
  let dropped = [];

  if (!localOnly) {
    const { data: raw, meta: aiMeta } = await runJsonTask('ui_authoring', {
      messages: prompts.uiAuthoring({
        context: modelContextFor(context),
        studentMessage: data.prompt,
        mode: data.mode,
        continuation: data.sessionId ? { topic: context.concept?.name || context.analysis.conceptName } : null,
      }),
      meta: {
        task: 'ui_authoring',
        concept: context.concept || { name: context.analysis.conceptName },
        conceptId: context.concept?._id || null,
        profile: context.profile,
        openGaps: context.openGaps,
        adaptiveLevel: context.analysis.level,
        question: data.prompt,
      },
      feature: 'dynamic_ui',
      userId,
      classroomId: context.classroom?._id || null,
      timeoutMs: 55_000,
    });
    meta = { provider: aiMeta.provider, model: aiMeta.model, latencyMs: aiMeta.latencyMs, simulated: Boolean(aiMeta.simulated) };

    if (raw && typeof raw === 'object') {
      const authored = authorTutorial({
        raw,
        question: data.prompt,
        concept: context.concept,
        level: context.analysis.level,
        subject: context.subject?.name || '',
        responseId,
      });
      if (authored.document) {
        document = authored.document;
        source = authored.source;
        dropped = authored.dropped || [];
      }
    }
  }

  // Fallback ladder, step 3: the deterministic tutorial engine. It is a real
  // lesson, not an apology, which is why a missing API key does not degrade the
  // product into "AI unavailable".
  if (!document) {
    const local = buildLocalTutorial({
      question: data.prompt,
      concept: context.concept,
      level: context.analysis.level,
      subject: context.subject?.name || '',
      responseId,
    });
    document = local.document;
    source = localOnly ? 'local' : source === 'model' ? 'local-fallback' : source;
  }

  // Persist. `lessonId` is the response id: stable for this lesson, unique per
  // generation, and safe to use as a progress key without exposing an ObjectId.
  const db = getDb();
  const lessonDoc = {
    lessonId: document.response_id,
    userId: toOid(userId),
    classroomId: context.classroom?._id || null,
    conceptId: context.concept?._id || null,
    sessionId: data.sessionId && ObjectId.isValid(data.sessionId) ? toOid(data.sessionId) : null,
    prompt: data.prompt,
    mode: data.mode,
    level: context.analysis.level,
    subject: context.analysis.subject,
    source,
    provider: meta.provider || null,
    model: meta.model || null,
    document,
    dropped,
    createdAt: new Date(),
  };
  await db.collection('ui_lessons').insertOne(lessonDoc);

  return {
    document,
    source,
    analysis: context.analysis,
    dropped,
    ai: meta,
    lesson: {
      lessonId: document.response_id,
      conceptId: context.concept ? String(context.concept._id) : null,
      classroomId: context.classroom ? String(context.classroom._id) : null,
      conceptName: context.concept?.name || context.analysis.conceptName,
      plainText: documentToPlainText(document),
    },
  };
}

/** Load a previously authored lesson, scoped to its owner. */
export async function loadLesson({ userId, lessonId }) {
  const db = getDb();
  const doc = await db.collection('ui_lessons').findOne({ lessonId: String(lessonId).slice(0, 80), userId: toOid(userId) });
  if (!doc) throw notFound('Lesson not found');
  const valid = parseUiDocument(doc.document);
  return {
    document: valid.ok ? valid.document : fallbackTextDocument(documentToPlainText(doc.document), { responseId: doc.lessonId }),
    lessonId: doc.lessonId,
    prompt: doc.prompt,
    source: doc.source,
    conceptId: doc.conceptId ? String(doc.conceptId) : null,
    classroomId: doc.classroomId ? String(doc.classroomId) : null,
    createdAt: doc.createdAt,
  };
}

/** Questions for a lesson component, as stored (server-side source of truth). */
export async function lessonComponent({ userId, lessonId, componentId }) {
  const db = getDb();
  const doc = await db.collection('ui_lessons').findOne({ lessonId: String(lessonId).slice(0, 80), userId: toOid(userId) });
  if (!doc) throw notFound('Lesson not found');
  const stack = [...(doc.document?.components || [])];
  while (stack.length) {
    const component = stack.pop();
    if (!component) continue;
    if (component.id === componentId) return { component, lesson: doc };
    if (component.children) stack.push(...component.children);
    if (component.tabs) component.tabs.forEach((t) => stack.push(...(t.children || [])));
    if (component.items) component.items.forEach((i) => stack.push(...(i.children || [])));
  }
  throw notFound('Component not found in this lesson');
}

/**
 * Validate a form submission against the stored question schema.
 *
 * The client validates for UX; this validates for correctness. Required
 * questions must be present, option-based answers must be one of the offered
 * options, numbers must be numeric and in range, and code/length ceilings apply.
 */
export function validateAnswers({ questions = [], answers = [] }) {
  const byId = new Map();
  for (const answer of answers || []) {
    if (!answer || typeof answer !== 'object') continue;
    byId.set(String(answer.question_id), answer.value);
  }
  const errors = [];
  const accepted = [];

  for (const q of questions) {
    const value = byId.get(String(q.id));
    const missing = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    if (missing) {
      if (q.required !== false) errors.push({ question_id: q.id, message: 'This question is required.' });
      else accepted.push({ question_id: q.id, value: null, answered: false });
      continue;
    }
    const optionValues = (q.options || []).map((o) => (typeof o === 'string' ? o : o?.value ?? o?.label)).map(String);

    if (['radio', 'select'].includes(q.type)) {
      const text = String(value);
      if (optionValues.length && !optionValues.includes(text)) {
        errors.push({ question_id: q.id, message: 'Choose one of the offered options.' });
        continue;
      }
    } else if (q.type === 'checkbox_group') {
      const list = Array.isArray(value) ? value.map(String) : [String(value)];
      if (optionValues.length && list.some((v) => !optionValues.includes(v))) {
        errors.push({ question_id: q.id, message: 'One or more selections are not offered options.' });
        continue;
      }
    } else if (['number', 'slider'].includes(q.type)) {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        errors.push({ question_id: q.id, message: 'Enter a number.' });
        continue;
      }
      const min = q.min ?? q.validation?.min;
      const max = q.max ?? q.validation?.max;
      if (min !== undefined && num < Number(min)) {
        errors.push({ question_id: q.id, message: `Must be at least ${min}.` });
        continue;
      }
      if (max !== undefined && num > Number(max)) {
        errors.push({ question_id: q.id, message: `Must be at most ${max}.` });
        continue;
      }
    } else if (q.type === 'boolean') {
      if (typeof value !== 'boolean' && !['true', 'false'].includes(String(value))) {
        errors.push({ question_id: q.id, message: 'Answer yes or no.' });
        continue;
      }
    } else if (q.type === 'code_input') {
      if (String(value).length > UI_LIMITS.maxCodeChars) {
        errors.push({ question_id: q.id, message: `Code is limited to ${UI_LIMITS.maxCodeChars} characters.` });
        continue;
      }
    } else if (q.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        errors.push({ question_id: q.id, message: 'Use the date picker (YYYY-MM-DD).' });
        continue;
      }
    } else if (q.type === 'file_upload') {
      // Files are uploaded separately and referenced by id; never inline here.
      const ok = typeof value === 'object' && value && typeof value.file_id === 'string';
      if (!ok) {
        errors.push({ question_id: q.id, message: 'Upload the file again — the reference is missing.' });
        continue;
      }
    } else {
      const text = String(value);
      if (text.length > UI_LIMITS.maxText) {
        errors.push({ question_id: q.id, message: `Answers are limited to ${UI_LIMITS.maxText} characters.` });
        continue;
      }
      const minLength = q.validation?.min_length;
      const maxLength = q.validation?.max_length;
      if (minLength && text.length < Number(minLength)) {
        errors.push({ question_id: q.id, message: `Write at least ${minLength} characters.` });
        continue;
      }
      if (maxLength && text.length > Number(maxLength)) {
        errors.push({ question_id: q.id, message: `Write at most ${maxLength} characters.` });
        continue;
      }
    }
    accepted.push({ question_id: q.id, value, answered: true });
  }

  if (errors.length) {
    throw badRequest('Some answers need attention before submission', errors);
  }
  return accepted;
}
