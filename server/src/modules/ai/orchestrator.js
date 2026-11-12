import { getDb } from '../../db/index.js';
import { getRuntimeConfig, resolveTask, isFeatureEnabled, getConfigBundle } from './config-store.js';
import { NvidiaProvider } from './providers/nvidia.js';
import { LocalProvider } from './providers/local.js';
import { ProviderError } from './providers/base.js';
import { MODEL_PRICING, TASK_FEATURE_MAP } from './catalog.js';
import { tooMany } from '../../utils/errors.js';
import { round } from '../../utils/validation.js';

/**
 * AI Orchestration Service — the single entry point for every AI capability.
 *
 * Responsibilities:
 *  - task-based routing (admin configurable, no code changes needed)
 *  - provider adapters (NVIDIA today, anything else tomorrow)
 *  - retries, timeouts, fallback models
 *  - structured JSON response parsing/repair
 *  - cache (dedupe identical deterministic requests)
 *  - per-user rate limiting
 *  - usage accounting (tokens, latency, cost, failures) -> ai_usage_logs
 */

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 300;

const rateBuckets = new Map();
const RATE_LIMIT = { windowMs: 60_000, max: 60 };

let providerCache = { key: '', provider: null };

function getProvider(runtime) {
  const key = `${runtime.baseUrl}|${runtime.apiKey}`;
  if (providerCache.key === key && providerCache.provider) return providerCache.provider;
  const provider = runtime.hasApiKey
    ? new NvidiaProvider({ apiKey: runtime.apiKey, baseUrl: runtime.baseUrl, timeoutMs: runtime.timeoutMs })
    : new LocalProvider();
  providerCache = { key, provider };
  return provider;
}

export function getLocalProvider() {
  return new LocalProvider();
}

function rateLimit(userId) {
  if (!userId) return;
  const now = Date.now();
  const bucket = rateBuckets.get(String(userId)) || [];
  const recent = bucket.filter((t) => now - t < RATE_LIMIT.windowMs);
  if (recent.length >= RATE_LIMIT.max) {
    throw tooMany('AI request limit reached. Please wait a moment before sending more messages.');
  }
  recent.push(now);
  rateBuckets.set(String(userId), recent);
}

function cacheKey(task, model, messages, meta) {
  const payload = JSON.stringify({
    task,
    model,
    messages,
    signal: meta?.signal || null,
    conceptId: meta?.conceptId || null,
    level: meta?.adaptiveLevel || null,
  });
  let h = 0;
  for (let i = 0; i < payload.length; i += 1) h = (h * 31 + payload.charCodeAt(i)) | 0;
  return `${task}:${model}:${h}`;
}

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

export function clearAiCache() {
  cache.clear();
}

/** Extract the first JSON object/array from a model response (handles code fences and prose). */
export function extractJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through */
  }
  const firstBrace = candidate.search(/[[{]/);
  if (firstBrace === -1) return null;
  const openChar = candidate[firstBrace];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = firstBrace; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(firstBrace, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function logUsage(entry) {
  try {
    const db = getDb();
    await db.collection('ai_usage_logs').insertOne({ ...entry, createdAt: new Date() });
  } catch {
    /* usage logging must never break a request */
  }
}

function costOf(model, usage) {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  const inCost = ((usage.inputTokens || 0) / 1000) * (p.input || 0);
  const outCost = ((usage.outputTokens || 0) / 1000) * (p.output || 0);
  return Number((inCost + outCost).toFixed(8));
}

/**
 * Core JSON-producing AI call.
 * @returns {{ data: any, meta: { provider, model, latencyMs, tokens, cached, simulated, fallbackUsed } }}
 */
export async function runJsonTask(task, { messages, meta = {}, feature, userId, classroomId, cacheable = false, signal } = {}) {
  const feat = feature || TASK_FEATURE_MAP[task];
  if (feat && !(await isFeatureEnabled(feat))) {
    return {
      data: null,
      meta: { disabled: true, feature: feat, provider: 'none', model: 'none', tokens: { inputTokens: 0, outputTokens: 0 } },
    };
  }
  rateLimit(userId);

  const runtime = await getRuntimeConfig();
  const { route, primary, fallback } = await resolveTask(task);
  const provider = getProvider(runtime);

  const models = [];
  if (primary) models.push(primary.modelId);
  else if (route?.model) models.push(route.model);
  if (fallback && fallback.modelId && fallback.modelId !== models[0]) models.push(fallback.modelId);

  const override = runtime.taskOverrides?.[task] || {};
  const modelParamsFor = (modelId) => {
    const reg = [...(primary ? [primary] : []), ...(fallback ? [fallback] : [])].find((m) => m.modelId === modelId);
    return {
      temperature: override.temperature ?? reg?.params?.temperature ?? runtime.generation.temperature,
      topP: override.topP ?? reg?.params?.topP ?? runtime.generation.topP,
      maxTokens: override.maxTokens ?? reg?.params?.maxTokens ?? runtime.generation.maxTokens,
    };
  };

  const key = cacheable ? cacheKey(task, models[0], messages, meta) : null;
  if (key) {
    const hit = getCached(key);
    if (hit) return { data: hit, meta: { ...hit.__meta, cached: true } };
  }

  let lastError = null;
  for (let mi = 0; mi < models.length; mi += 1) {
    const modelId = models[mi];
    const params = modelParamsFor(modelId);
    let attempt = 0;
    const maxAttempts = Math.max(1, (runtime.maxRetries || 0) + 1);
    while (attempt < maxAttempts) {
      const startedAt = Date.now();
      try {
        const res = await provider.chat({
          model: modelId,
          messages,
          temperature: params.temperature,
          topP: params.topP,
          maxTokens: params.maxTokens,
          jsonMode: runtime.generation.jsonMode,
          timeoutMs: runtime.timeoutMs,
          meta: { ...meta, task: meta.task || task },
          signal,
        });
        const parsed = extractJson(res.text);
        await logUsage({
          task,
          feature: feat || 'general',
          provider: res.provider,
          model: res.model || modelId,
          userId: userId || null,
          classroomId: classroomId || null,
          inputTokens: res.usage?.inputTokens || 0,
          outputTokens: res.usage?.outputTokens || 0,
          costUsd: costOf(modelId, res.usage || {}),
          latencyMs: res.latencyMs || Date.now() - startedAt,
          success: true,
          error: null,
          cached: false,
          simulated: Boolean(res.simulated),
        });
        const metaOut = {
          provider: res.provider,
          model: res.model || modelId,
          latencyMs: res.latencyMs || Date.now() - startedAt,
          tokens: res.usage || { inputTokens: 0, outputTokens: 0 },
          cached: false,
          simulated: Boolean(res.simulated),
          fallbackUsed: mi > 0,
          raw: res.text,
          parsed: Boolean(parsed),
        };
        const data = parsed ?? res.text;
        if (key) setCached(key, data);
        return { data, meta: metaOut };
      } catch (err) {
        lastError = err;
        attempt += 1;
        const retryable = err instanceof ProviderError ? err.retryable : true;
        await logUsage({
          task,
          feature: feat || 'general',
          provider: provider.name,
          model: modelId,
          userId: userId || null,
          classroomId: classroomId || null,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - startedAt,
          success: false,
          error: err.message,
          cached: false,
        });
        if (!retryable || attempt >= maxAttempts) break;
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }
  }

  // Hard failure: if the remote provider is down but simulation is allowed,
  // fall back to the local deterministic analyser so learning is not blocked.
  if (runtime.hasApiKey) {
    try {
      const local = new LocalProvider();
      const res = await local.chat({ model: models[0] || route?.model || 'local', messages, meta: { ...meta, task: meta.task || task } });
      const parsed = extractJson(res.text);
      return {
        data: parsed ?? res.text,
        meta: { provider: 'local-fallback', model: res.model, latencyMs: res.latencyMs, tokens: res.usage, fallbackUsed: true, error: lastError?.message },
      };
    } catch {
      /* ignore */
    }
  }
  throw lastError || new Error('AI request failed');
}

/** Embedding via the embed model route with a deterministic local fallback. */
export async function runEmbeddings(texts, { userId, classroomId } = {}) {
  const runtime = await getRuntimeConfig();
  const { route } = await resolveTask('embeddings');
  if (!runtime.hasApiKey) {
    const local = new LocalProvider();
    const res = await local.embed({ model: route?.model || 'local', input: texts });
    await logUsage({
      task: 'embeddings',
      feature: 'syllabus_retrieval',
      provider: 'local',
      model: res.model,
      userId: userId || null,
      classroomId: classroomId || null,
      inputTokens: res.usage.inputTokens,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: res.latencyMs,
      success: true,
      cached: false,
      simulated: true,
    });
    return res.vectors;
  }
  const provider = getProvider(runtime);
  const started = Date.now();
  try {
    const res = await provider.embed({ model: route?.model, input: texts, timeoutMs: runtime.timeoutMs });
    await logUsage({
      task: 'embeddings',
      feature: 'syllabus_retrieval',
      provider: 'nvidia',
      model: res.model,
      userId: userId || null,
      classroomId: classroomId || null,
      inputTokens: res.usage.inputTokens,
      outputTokens: 0,
      costUsd: costOf(route?.model, res.usage),
      latencyMs: res.latencyMs || Date.now() - started,
      success: true,
      cached: false,
    });
    return res.vectors;
  } catch (err) {
    const local = new LocalProvider();
    const res = await local.embed({ model: route?.model || 'local', input: texts });
    return res.vectors;
  }
}

export async function runRerank(query, documents, { userId, classroomId } = {}) {
  const runtime = await getRuntimeConfig();
  const { route } = await resolveTask('rerank');
  const provider = runtime.hasApiKey ? getProvider(runtime) : new LocalProvider();
  const started = Date.now();
  try {
    const res = await provider.rerank({ model: route?.model, query, documents, timeoutMs: runtime.timeoutMs });
    await logUsage({
      task: 'rerank',
      feature: 'syllabus_retrieval',
      provider: provider.name,
      model: res.model,
      userId: userId || null,
      classroomId: classroomId || null,
      inputTokens: res.usage?.inputTokens || 0,
      outputTokens: 0,
      costUsd: costOf(route?.model, res.usage || {}),
      latencyMs: res.latencyMs || Date.now() - started,
      success: true,
      cached: false,
    });
    return res.results;
  } catch {
    const local = new LocalProvider();
    const res = await local.rerank({ model: route?.model || 'local', query, documents });
    return res.results;
  }
}

/** Model availability check against the live catalogue (admin action). */
export async function verifyModelAvailability() {
  const runtime = await getRuntimeConfig();
  const provider = getProvider(runtime);
  let available = [];
  let detail = '';
  let ok = false;
  try {
    available = await provider.listModels();
    ok = true;
    detail = runtime.hasApiKey
      ? `Catalogue reachable — ${available.length} models reported by ${runtime.baseUrl}`
      : 'No API key configured: models cannot be verified against the live catalogue.';
  } catch (err) {
    detail = err.message;
  }
  const bundle = await getConfigBundle(true);
  const db = getDb();
  const results = [];
  for (const model of bundle.models) {
    let availability = 'unknown';
    let message = detail;
    if (!runtime.hasApiKey) {
      availability = 'unknown';
    } else if (!ok) {
      availability = 'unavailable';
    } else if (available.includes(model.modelId)) {
      availability = 'available';
      message = 'Verified in provider catalogue';
    } else {
      availability = 'unavailable';
      message = 'Not present in provider catalogue response';
    }
    await db.collection('ai_models').updateOne(
      { _id: model._id },
      { $set: { availability, validationMessage: message, validatedAt: new Date() } },
    );
    results.push({ modelId: model.modelId, availability, message });
  }
  const { invalidateAiCache } = await import('./config-store.js');
  invalidateAiCache();
  return { provider: provider.name, catalogueReachable: ok, detail, models: results };
}

export async function providerHealth() {
  const runtime = await getRuntimeConfig();
  const provider = getProvider(runtime);
  const health = await provider.healthCheck();
  return {
    ...health,
    provider: provider.name,
    baseUrl: runtime.baseUrl,
    hasApiKey: runtime.hasApiKey,
    credentialSource: runtime.credentialSource,
    timeoutMs: runtime.timeoutMs,
    maxRetries: runtime.maxRetries,
  };
}

/** Aggregated usage analytics for the admin dashboard. */
export async function usageAnalytics({ days = 30 } = {}) {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const match = { createdAt: { $gte: since } };
  const [totals] = await db
    .collection('ai_usage_logs')
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          requests: { $sum: 1 },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          cost: { $sum: '$costUsd' },
          failures: { $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] } },
          latencySum: { $sum: '$latencyMs' },
          latencyMax: { $max: '$latencyMs' },
        },
      },
    ])
    .toArray();

  const byModel = await db
    .collection('ai_usage_logs')
    .aggregate([
      { $match: match },
      { $group: { _id: '$model', requests: { $sum: 1 }, inputTokens: { $sum: '$inputTokens' }, outputTokens: { $sum: '$outputTokens' }, cost: { $sum: '$costUsd' }, latency: { $avg: '$latencyMs' }, failures: { $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] } } } },
      { $sort: { requests: -1 } },
    ])
    .toArray();

  const byFeature = await db
    .collection('ai_usage_logs')
    .aggregate([
      { $match: match },
      { $group: { _id: '$feature', requests: { $sum: 1 }, cost: { $sum: '$costUsd' }, tokens: { $sum: { $add: ['$inputTokens', '$outputTokens'] } } } },
      { $sort: { requests: -1 } },
    ])
    .toArray();

  const byTask = await db
    .collection('ai_usage_logs')
    .aggregate([
      { $match: match },
      { $group: { _id: '$task', requests: { $sum: 1 }, failures: { $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] } }, latency: { $avg: '$latencyMs' } } },
      { $sort: { requests: -1 } },
    ])
    .toArray();

  const byClassroom = await db
    .collection('ai_usage_logs')
    .aggregate([
      { $match: { ...match, classroomId: { $ne: null } } },
      { $group: { _id: '$classroomId', requests: { $sum: 1 }, tokens: { $sum: { $add: ['$inputTokens', '$outputTokens'] } }, cost: { $sum: '$costUsd' } } },
      { $sort: { requests: -1 } },
      { $limit: 20 },
    ])
    .toArray();

  const classroomIds = byClassroom.map((c) => c._id).filter(Boolean);
  const classrooms = classroomIds.length
    ? await db.collection('classrooms').find({ _id: { $in: classroomIds } }).project({ name: 1, code: 1 }).toArray()
    : [];
  const nameById = Object.fromEntries(classrooms.map((c) => [String(c._id), c]));

  const daily = await db
    .collection('ai_usage_logs')
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          requests: { $sum: 1 },
          tokens: { $sum: { $add: ['$inputTokens', '$outputTokens'] } },
          cost: { $sum: '$costUsd' },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray()
    .catch(() => []);

  const recentFailures = await db
    .collection('ai_usage_logs')
    .find({ success: false })
    .sort({ createdAt: -1 })
    .limit(25)
    .toArray();

  return {
    rangeDays: days,
    totals: {
      requests: totals?.requests || 0,
      inputTokens: totals?.inputTokens || 0,
      outputTokens: totals?.outputTokens || 0,
      costUsd: round(totals?.cost || 0, 6),
      failures: totals?.failures || 0,
      avgLatencyMs: totals?.requests ? Math.round(totals.latencySum / totals.requests) : 0,
      maxLatencyMs: totals?.latencyMax || 0,
      successRate: totals?.requests ? round(((totals.requests - totals.failures) / totals.requests) * 100, 1) : 100,
    },
    byModel: byModel.map((m) => ({ model: m._id, requests: m.requests, inputTokens: m.inputTokens, outputTokens: m.outputTokens, costUsd: round(m.cost, 6), avgLatencyMs: Math.round(m.latency || 0), failures: m.failures })),
    byFeature: byFeature.map((f) => ({ feature: f._id, requests: f.requests, tokens: f.tokens, costUsd: round(f.cost, 6) })),
    byTask: byTask.map((t) => ({ task: t._id, requests: t.requests, failures: t.failures, avgLatencyMs: Math.round(t.latency || 0) })),
    byClassroom: byClassroom.map((c) => ({
      classroomId: String(c._id),
      name: nameById[String(c._id)]?.name || 'Unknown classroom',
      code: nameById[String(c._id)]?.code || '',
      requests: c.requests,
      tokens: c.tokens,
      costUsd: round(c.cost, 6),
    })),
    daily,
    recentFailures: recentFailures.map((f) => ({ task: f.task, model: f.model, error: f.error, at: f.createdAt })),
  };
}
