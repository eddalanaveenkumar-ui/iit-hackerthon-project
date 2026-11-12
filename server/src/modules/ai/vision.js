/**
 * Vision: reading a student's work from a photo.
 *
 * Only DeepSeek V4.1 Flash in the registry is multimodal, so this module is
 * deliberately small and honest: it either calls that model or reports that
 * vision is unavailable. It never guesses at an image's contents.
 *
 * The endpoint resolution, key handling, retry and usage logging all come from
 * the existing orchestrator/adapter path, so nothing here re-implements HTTP.
 */
import { getDb } from '../../db/index.js';
import { getConfigBundle } from './config-store.js';
import { runJsonTask, providerHealth } from './orchestrator.js';
import { MODEL_REGISTRY_SEED } from './catalog.js';

/** The model that can actually see. */
export const VISION_MODEL = 'deepseek-ai/deepseek-v4.1-flash';

export const VISION_MAX_BYTES = 5 * 1024 * 1024;
export const VISION_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const HANDS_ON_PROMPT = [
  'You are looking at a photograph of a student\'s work — handwriting, a whiteboard, a printed worksheet or a screenshot of broken code.',
  'Transcribe what is actually visible, then diagnose it as a tutor would.',
  '',
  'Rules:',
  '- Only describe what you can see. If the image is blurry, cropped or empty, say so in "unreadable" and stop.',
  '- Never invent code or answers that are not in the image.',
  '- Quote the student\'s own wording in "transcription".',
  '',
  'Return JSON only:',
  '{',
  '  "kind": "handwriting" | "code" | "diagram" | "worksheet" | "unreadable",',
  '  "transcription": string,',
  '  "summary": string,',
  '  "errors": [{ "where": string, "what": string, "why": string, "fix": string }],',
  '  "nextStep": string,',
  '  "confidence": number',
  '}',
].join('\n');

export function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return { error: 'expected a data URL string' };
  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) return { error: 'image must be a base64 data URL (data:image/png;base64,…)' };
  const [, mimeType, base64] = match;
  if (!VISION_MIME_TYPES.includes(mimeType.toLowerCase())) {
    return { error: `unsupported image type ${mimeType}; allowed: ${VISION_MIME_TYPES.join(', ')}` };
  }
  // 4 base64 chars encode 3 bytes; this is exact enough for a size guard.
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > VISION_MAX_BYTES) {
    return { error: `image is ${(bytes / 1024 / 1024).toFixed(1)}MB; the limit is ${VISION_MAX_BYTES / 1024 / 1024}MB` };
  }
  if (!base64.length) return { error: 'image data is empty' };
  return { dataUrl: `data:${mimeType};base64,${base64}`, mimeType, bytes };
}

async function visionModelLive() {
  const db = getDb();
  const doc = await db.collection('ai_models').findOne({ modelId: VISION_MODEL });
  if (!doc) return { live: false, reason: 'the vision model is not in the registry' };
  if (doc.retired) return { live: false, reason: doc.validationMessage || 'the vision model was retired' };
  if (doc.enabled === false) return { live: false, reason: 'the vision model is disabled in AI configuration' };
  return { live: true };
}

/**
 * Read a photo of student work.
 *
 * @param {{ image: string, prompt?: string, conceptName?: string, userId?: string, classroomId?: string }} input
 */
export async function readImage({ image, prompt, conceptName, userId, classroomId } = {}) {
  const parsed = parseDataUrl(image);
  if (parsed.error) return { ok: false, code: 'INVALID_IMAGE', error: parsed.error };

  const model = await visionModelLive();
  if (!model.live) return { ok: false, code: 'VISION_UNAVAILABLE', error: `Vision is not available: ${model.reason}` };

  const health = await providerHealth();
  if (!health.hasApiKey) {
    return {
      ok: false,
      code: 'NO_CREDENTIALS',
      error: 'No NVIDIA API key is configured, so the image cannot be read. Add one in Admin → AI configuration.',
    };
  }

  const parts = [
    { type: 'text', text: prompt ? `${HANDS_ON_PROMPT}\n\nStudent asks: ${prompt}` : HANDS_ON_PROMPT },
  ];
  if (conceptName) parts.push({ type: 'text', text: `Topic being studied: ${conceptName}` });
  parts.push({ type: 'image_url', image_url: { url: parsed.dataUrl } });

  try {
    // Pinned: the practical_detection route points at a text-only model, which
    // would drop the image and answer from the prompt alone.
    const { data, meta } = await runJsonTask('practical_detection', {
      messages: [{ role: 'user', content: parts }],
      meta: { purpose: 'vision_handwriting' },
      feature: 'code_analysis',
      userId,
      classroomId,
      pinModel: VISION_MODEL,
    });
    return {
      ok: true,
      model: meta?.model || VISION_MODEL,
      reading: normaliseReading(data),
      latencyMs: meta?.latencyMs ?? null,
      bytes: parsed.bytes,
    };
  } catch (err) {
    return { ok: false, code: 'UPSTREAM_ERROR', error: err.message };
  }
}

/** Models that accept image content, derived from the catalogue rather than assumed. */
export function listVisionModels() {
  return MODEL_REGISTRY_SEED.filter((m) => m.capabilities?.includes('vision')).map((m) => ({
    modelId: m.modelId,
    displayName: m.displayName,
    notes: m.notes,
  }));
}

/**
 * Which task routes can carry image content.
 *
 * A route qualifies only if its *primary* model sees, because the fallback is
 * only reached after the primary fails — routing an image to a text-only primary
 * would silently discard it.
 */
export async function visionTasks() {
  const bundle = await getConfigBundle();
  const visionIds = new Set(
    bundle.models.filter((m) => !m.retired && m.enabled && m.capabilities?.includes('vision')).map((m) => m.modelId),
  );
  const routed = Object.values(bundle.routes)
    .filter((r) => visionIds.has(r.model))
    .map((r) => r.task);
  return [...new Set(routed)];
}

export function normaliseReading(data) {
  const d = data && typeof data === 'object' ? data : {};
  const kind = ['handwriting', 'code', 'diagram', 'worksheet', 'unreadable'].includes(d.kind) ? d.kind : 'unreadable';
  const errors = Array.isArray(d.errors)
    ? d.errors
        .filter((e) => e && typeof e === 'object')
        .slice(0, 8)
        .map((e) => ({
          where: String(e.where || '').slice(0, 200),
          what: String(e.what || '').slice(0, 400),
          why: String(e.why || '').slice(0, 600),
          fix: String(e.fix || '').slice(0, 600),
        }))
    : [];
  const conf = Number(d.confidence);
  return {
    kind,
    transcription: String(d.transcription || '').slice(0, 4000),
    summary: String(d.summary || '').slice(0, 1200),
    errors,
    nextStep: String(d.nextStep || '').slice(0, 600),
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
  };
}
