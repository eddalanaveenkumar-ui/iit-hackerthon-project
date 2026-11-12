import config from '../../config/index.js';
import { getDb } from '../../db/index.js';
import { decryptSecret } from '../../utils/crypto.js';
import {
  AI_TASKS,
  DEFAULT_MODEL_REGISTRY,
  FEATURE_DEFINITIONS,
  RETIRED_MODEL_REPLACEMENTS,
  RETIRED_MODELS,
} from './catalog.js';

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

/**
 * Environment variable holding a model's own key, when one is set.
 *
 * `credentialKey` is the per-model slot declared in the catalogue
 * (NVIDIA_API_KEY_LIGHTNING, ..._ULTRA, ...). `envHint` is a derived fallback so
 * a model added to the registry later still gets its own variable without a
 * code change: nvidia/nemotron-3.5-parse -> NVIDIA_NEMOTRON_3_5_PARSE_KEY.
 */
export function envKeyFor(model) {
  if (!model) return '';
  const explicit = config.ai.modelKeys?.[model.modelId];
  if (explicit) return explicit;
  const slot = model.credentialKey ? process.env[model.credentialKey] : '';
  if (slot) return slot;
  return process.env[envSlotName(model.modelId)] || '';
}

/** Derive an environment slot name from a model id. */
export function envSlotName(modelId) {
  return `${String(modelId)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}_API_KEY`;
}

/**
 * Model documents keyed by modelId, with each model's own credentials resolved.
 * Passed to the provider so a model can use its own endpoint, key and path
 * instead of the global NVIDIA configuration.
 *
 * The resolved key is stored as `apiKeyCipher` because that is the field the
 * endpoint resolver reads; it holds plaintext in memory only for this request
 * and is never serialised. `credentialSource` records where it came from so the
 * admin panel can show "own key (environment)" rather than just "own key".
 */
export function modelsById(bundle) {
  const out = {};
  for (const model of bundle.models || []) {
    const stored = model.apiKeyCipher ? decryptSecret(model.apiKeyCipher) : '';
    const fromEnv = stored ? '' : envKeyFor(model);
    out[model.modelId] = {
      ...model,
      apiKeyCipher: stored || fromEnv,
      credentialSource: stored ? 'model' : fromEnv ? 'model-env' : 'none',
      credentialSlot: model.credentialKey || envSlotName(model.modelId),
      hasStoredKey: Boolean(stored),
      hasEnvKey: Boolean(fromEnv),
    };
  }
  return out;
}

export async function getRuntimeConfig() {
  const bundle = await getConfigBundle();
  const cfg = bundle.config || {};
  const apiKey = decryptSecret(cfg.apiKeyCipher) || config.ai.nvidiaApiKey || '';
  const models = modelsById(bundle);
  // A model with its own key counts as "configured" even when the global key is
  // empty — that is the whole point of per-model credentials.
  const anyModelKey = Object.values(models).some((m) => m.apiKeyCipher);
  const withCredentials = Object.values(models).filter((m) => m.apiKeyCipher).length;
  return {
    provider: cfg.provider || 'nvidia',
    baseUrl: cfg.baseUrl || config.ai.nvidiaBaseUrl,
    apiKey,
    models,
    hasApiKey: Boolean(apiKey) || anyModelKey,
    modelKeyCount: withCredentials,
    modelCount: Object.keys(models).length,
    // Six models, six credential slots. This is the number the admin panel
    // reports so "5 of 6 keys configured" is visible before a lesson fails.
    credentialsFromEnv: Object.values(models).filter((m) => m.credentialSource === 'model-env').length,
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

  // Retire models that are not callable upstream.
  //
  // The seed is only *inserted* when missing, so a deployment that was created
  // before a model was found to be unavailable still holds it. Left alone it
  // would keep advertising a route that 404s on every call, so any stored route
  // pointing at one is re-pointed here, and the model document is disabled
  // (never deleted — usage history references it).
  const retiredIds = Object.keys(RETIRED_MODELS);
  if (retiredIds.length) {
    const retiredModels = await db
      .collection('ai_models')
      .find({ modelId: { $in: retiredIds } })
      .toArray();
    for (const m of retiredModels) {
      // Re-assert the whole state, not just the first time.
      //
      // Skipping when `retired` is already true looked idempotent but was not:
      // an admin can toggle `enabled` back on from the panel, and the model then
      // stays retired-but-enabled forever. Production ended up exactly like that
      // with deepseek-v4-flash, and the smoke suite caught it. Every boot now
      // restores the invariant: a retired model is always disabled and always
      // marked unavailable.
      const settled = m.retired && m.enabled === false && m.availability === 'unavailable';
      if (settled) continue;
      await db.collection('ai_models').updateOne(
        { _id: m._id },
        {
          $set: {
            retired: true,
            enabled: false,
            availability: 'unavailable',
            validationMessage: RETIRED_MODELS[m.modelId] || 'Not available upstream',
            updatedAt: new Date(),
          },
        },
      );
    }
    for (const [from, to] of Object.entries(RETIRED_MODEL_REPLACEMENTS)) {
      await db
        .collection('ai_task_routing')
        .updateMany({ model: from }, { $set: { model: to, updatedAt: new Date() } });
      await db
        .collection('ai_task_routing')
        .updateMany({ fallbackModel: from }, { $set: { fallbackModel: to, updatedAt: new Date() } });
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
    } else if (!DEFAULT_MODEL_REGISTRY.some((m) => m.modelId === existing.model)) {
      // The catalogue changed under an existing route — keep it pointing at a
      // model that actually exists rather than failing every call.
      await db.collection('ai_task_routing').updateOne(
        { _id: task.key },
        { $set: { model: task.defaultModel, updatedAt: new Date() } },
      );
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
