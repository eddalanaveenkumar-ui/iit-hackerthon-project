import config from '../../config/index.js';
import { getDb } from '../../db/index.js';
import { decryptSecret } from '../../utils/crypto.js';
import { AI_TASKS, DEFAULT_MODEL_REGISTRY, FEATURE_DEFINITIONS } from './catalog.js';

/**
 * Central AI configuration store.
 * Reads are cached in-process and invalidated on write, so admin changes take
 * effect without restarting the application.
 */
let cache = null;

async function loadAll() {
  const db = getDb();
  const [cfgDoc, models, routes, flags] = await Promise.all([
    db.collection('ai_config').findOne({ _id: 'global' }),
    db.collection('ai_models').find({}).toArray(),
    db.collection('ai_task_routing').find({}).toArray(),
    db.collection('ai_feature_flags').find({}).toArray(),
  ]);
  cache = {
    config: cfgDoc,
    models: models.sort((a, b) => a.category.localeCompare(b.category)),
    routes: Object.fromEntries(routes.map((r) => [r._id, r])),
    flags: Object.fromEntries(flags.map((f) => [f._id, f])),
    loadedAt: Date.now(),
  };
  return cache;
}

export async function getConfigBundle(force = false) {
  if (!cache || force) await loadAll();
  return cache;
}

export function invalidateAiCache() {
  cache = null;
}

export async function getRuntimeConfig() {
  const bundle = await getConfigBundle();
  const cfg = bundle.config || {};
  const apiKey = decryptSecret(cfg.apiKeyCipher) || config.ai.nvidiaApiKey || '';
  return {
    provider: cfg.provider || 'nvidia',
    baseUrl: cfg.baseUrl || config.ai.nvidiaBaseUrl,
    apiKey,
    hasApiKey: Boolean(apiKey),
    timeoutMs: cfg.timeoutMs ?? config.ai.requestTimeoutMs,
    maxRetries: cfg.maxRetries ?? config.ai.maxRetries,
    generation: {
      temperature: 0.4,
      topP: 0.95,
      maxTokens: 1400,
      stream: false,
      jsonMode: true,
      ...(cfg.generation || {}),
    },
    taskOverrides: cfg.taskOverrides || {},
    credentialSource: cfg.apiKeyCipher ? 'database' : apiKey ? 'environment' : 'none',
  };
}

export async function resolveTask(task) {
  const bundle = await getConfigBundle();
  const route = bundle.routes[task];
  if (!route) throw new Error(`No AI route configured for task "${task}"`);
  const enabledModels = bundle.models.filter((m) => m.enabled);
  const primary = enabledModels.find((m) => m.modelId === route.model);
  const fallback = route.fallbackModel ? enabledModels.find((m) => m.modelId === route.fallbackModel) : null;
  return { route, primary: primary || null, fallback: fallback || null };
}

export async function isFeatureEnabled(feature) {
  const bundle = await getConfigBundle();
  const f = bundle.flags[feature];
  return f ? Boolean(f.enabled) : true;
}

export async function setFeature(feature, enabled, updatedBy) {
  const db = getDb();
  const def = FEATURE_DEFINITIONS.find((f) => f.key === feature);
  if (!def) throw new Error('Unknown AI feature');
  await db.collection('ai_feature_flags').updateOne(
    { _id: feature },
    { $set: { _id: feature, label: def.label, description: def.description, enabled: Boolean(enabled), updatedAt: new Date(), updatedBy } },
    { upsert: true },
  );
  invalidateAiCache();
}

export async function bootstrapAiCatalog({ models = [], routes = [], flags = [], config: cfgOverrides = {} } = {}) {
  const db = getDb();

  // Model registry
  for (const model of DEFAULT_MODEL_REGISTRY) {
    const existing = await db.collection('ai_models').findOne({ provider: model.provider, modelId: model.modelId });
    if (!existing) {
      await db.collection('ai_models').insertOne({
        ...model,
        availability: model.availability || 'unknown',
        enabled: model.enabled !== undefined ? model.enabled : true,
        validatedAt: null,
        validationMessage: 'Not verified yet',
        createdAt: new Date(),
      });
    }
  }

  // Task routing
  for (const task of AI_TASKS) {
    const existing = await db.collection('ai_task_routing').findOne({ _id: task.key });
    if (!existing) {
      await db.collection('ai_task_routing').insertOne({
        _id: task.key,
        task: task.key,
        label: task.label,
        description: task.description,
        model: task.defaultModel,
        fallbackModel: task.defaultFallback || '',
        enabled: true,
        updatedAt: new Date(),
      });
    }
  }

  // Feature flags
  for (const feature of FEATURE_DEFINITIONS) {
    const existing = await db.collection('ai_feature_flags').findOne({ _id: feature.key });
    if (!existing) {
      await db.collection('ai_feature_flags').insertOne({
        _id: feature.key,
        label: feature.label,
        description: feature.description,
        category: feature.category,
        enabled: feature.defaultEnabled,
        updatedAt: new Date(),
      });
    }
  }

  // Global config singleton
  const existingConfig = await db.collection('ai_config').findOne({ _id: 'global' });
  if (!existingConfig) {
    await db.collection('ai_config').insertOne({
      _id: 'global',
      provider: 'nvidia',
      baseUrl: cfgOverrides.baseUrl || config.ai.nvidiaBaseUrl,
      apiKeyCipher: null,
      apiKeyFingerprint: '',
      timeoutMs: cfgOverrides.timeoutMs ?? config.ai.requestTimeoutMs,
      maxRetries: cfgOverrides.maxRetries ?? config.ai.maxRetries,
      generation: { temperature: 0.4, topP: 0.95, maxTokens: 1400, stream: false, jsonMode: true },
      taskOverrides: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  invalidateAiCache();
}
