import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../../utils/errors.js';
import { validate } from '../../utils/validation.js';
import { requireAdmin } from '../../middleware/auth.js';
import { encryptSecret, maskSecret, decryptSecret } from '../../utils/crypto.js';
import { logAudit } from '../classrooms/access.js';
import { readImage, listVisionModels, visionTasks, VISION_MIME_TYPES, VISION_MAX_BYTES } from './vision.js';
import {
  getConfigBundle,
  getRuntimeConfig,
  invalidateAiCache,
  setFeature,
} from './config-store.js';
import {
  verifyModelAvailability,
  providerHealth,
  usageAnalytics,
  clearAiCache,
  getProvider,
} from './orchestrator.js';
import { AI_TASKS, FEATURE_DEFINITIONS, UNAVAILABLE_MODELS, CATALOGUE_SLOT_COUNT } from './catalog.js';
import { validateBaseUrl, normalisePath, defaultPathFor, resolveEndpoint } from './endpoints.js';

const router = Router();

/**
 * Everything under /admin requires the platform administrator role.
 * Classroom owners get classroom-scoped feature controls only (see
 * /api/classrooms/:id/ai-settings) and never see provider credentials.
 */
router.use('/admin', requireAdmin);

/** Aggregated admin dashboard payload. */
router.get(
  '/admin/overview',
  asyncHandler(async (req, res) => {
    const bundle = await getConfigBundle(true);
    const runtime = await getRuntimeConfig();
    const health = await providerHealth();
    const cfg = bundle.config || {};
    res.json({
      provider: {
        name: runtime.provider,
        baseUrl: runtime.baseUrl,
        hasApiKey: runtime.hasApiKey,
        credentialSource: runtime.credentialSource,
        apiKeyPreview: cfg.apiKeyCipher ? maskSecret(decryptSecret(cfg.apiKeyCipher)) : runtime.hasApiKey ? '•••••••• (environment)' : '',
        timeoutMs: runtime.timeoutMs,
        maxRetries: runtime.maxRetries,
        simulateWhenUnavailable: !runtime.hasApiKey,
        health,
      },
      generation: runtime.generation,
      models: bundle.models.map((m) => publicModel(m, runtime.models?.[m.modelId])),
      credentials: {
        modelCount: runtime.modelCount || 0,
        configuredCount: runtime.modelKeyCount || 0,
        fromEnvironment: runtime.credentialsFromEnv || 0,
        globalKeyConfigured: Boolean(runtime.apiKey),
        // The number of *distinct* keys the platform is actually holding. If
        // this is 1 for six models, every model shares one quota.
        distinctKeySlots: new Set(
          Object.values(runtime.models || {})
            .filter((m) => m.apiKeyCipher)
            .map((m) => m.apiKeyCipher),
        ).size,
      },
      routing: Object.values(bundle.routes).map(publicRoute),
      features: Object.values(bundle.flags).map(publicFlag),
      tasks: AI_TASKS.map((t) => ({ key: t.key, label: t.label, description: t.description })),
      featureDefinitions: FEATURE_DEFINITIONS,
      updatedAt: cfg.updatedAt || null,
    });
  }),
);

/**
 * @param {object} m        stored ai_models document
 * @param {object} [runtime] resolved model from getRuntimeConfig().models, used
 *                           to report where its key came from without ever
 *                           exposing the key itself.
 */
function publicModel(m, runtime) {
  return {
    id: String(m._id),
    provider: m.provider,
    modelId: m.modelId,
    displayName: m.displayName,
    category: m.category,
    capabilities: m.capabilities || [],
    availability: m.availability || 'unknown',
    enabled: m.enabled !== false,
    params: m.params || {},
    notes: m.notes || '',
    validatedAt: m.validatedAt || null,
    validationMessage: m.validationMessage || '',
    retired: Boolean(m.retired),
    // Credential state per model. The key itself is never serialised — only
    // where it came from and where an operator can put a new one.
    credentialSlot: runtime?.credentialSlot || m.credentialKey || '',
    credentialSource: runtime?.credentialSource || 'none',
    hasStoredKey: Boolean(runtime?.hasStoredKey),
    hasEnvKey: Boolean(runtime?.hasEnvKey),
    apiKeyPreview: m.apiKeyPreview || '',
    endpointBaseUrl: m.endpointBaseUrl || '',
    endpointPath: m.endpointPath || '',
    inheritsGlobalKey: !runtime?.apiKeyCipher,
  };
}

function publicRoute(r) {
  return {
    task: r._id,
    label: r.label,
    description: r.description,
    model: r.model,
    fallbackModel: r.fallbackModel || '',
    enabled: r.enabled !== false,
  };
}

function publicFlag(f) {
  return { key: f._id, label: f.label, description: f.description, category: f.category, enabled: f.enabled !== false };
}

/** Provider credentials — write-only; the key is never returned. */
router.put(
  '/admin/provider',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        baseUrl: z.string().url().optional(),
        apiKey: z.string().min(8).max(400).optional(),
        clearApiKey: z.boolean().optional(),
        timeoutMs: z.number().int().min(1000).max(180000).optional(),
        maxRetries: z.number().int().min(0).max(5).optional(),
      }),
      req.body,
    );
    const db = getDb();
    const update = { updatedAt: new Date(), updatedBy: req.userId };
    if (data.baseUrl) update.baseUrl = data.baseUrl;
    if (data.timeoutMs !== undefined) update.timeoutMs = data.timeoutMs;
    if (data.maxRetries !== undefined) update.maxRetries = data.maxRetries;
    if (data.clearApiKey) {
      update.apiKeyCipher = null;
      update.apiKeyFingerprint = '';
    } else if (data.apiKey) {
      update.apiKeyCipher = encryptSecret(data.apiKey);
      update.apiKeyFingerprint = maskSecret(data.apiKey);
    }
    await db.collection('ai_config').updateOne({ _id: 'global' }, { $set: update }, { upsert: true });
    invalidateAiCache();
    clearAiCache();
    await logAudit({ actorId: req.userId, action: 'ai.provider_updated', meta: { baseUrl: update.baseUrl, keyChanged: Boolean(data.apiKey || data.clearApiKey) }, ip: req.ip });
    res.json({ ok: true, message: 'Provider settings saved. Changes are live without restart.' });
  }),
);

router.post(
  '/admin/provider/test',
  asyncHandler(async (req, res) => {
    const health = await providerHealth();
    res.json(health);
  }),
);

/** Live catalogue verification — models are never assumed to be available. */
router.post(
  '/admin/models/verify',
  asyncHandler(async (req, res) => {
    const result = await verifyModelAvailability();
    await logAudit({ actorId: req.userId, action: 'ai.models_verified', meta: { reachable: result.catalogueReachable }, ip: req.ip });
    res.json(result);
  }),
);

/**
 * Model IDs are namespaced (`nvidia/nemotron-…`, `qwen/qwen2.5-…`), so the route
 * must accept slashes. Express 5 ships path-to-regexp v8, which removed inline
 * regex parameters and array captures; a wildcard returns an array of segments,
 * which `modelIdFrom` joins back into the real ID.
 */
const MODEL_PATH = '*modelId';
const modelIdFrom = (req) => {
  const raw = req.params.modelId;
  return Array.isArray(raw) ? raw.join('/') : String(raw || '');
};

router.patch(
  `/admin/models/${MODEL_PATH}`,
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        enabled: z.boolean().optional(),
        displayName: z.string().min(2).max(120).optional(),
        // Per-model endpoint. Every NIM model family has its own route, and a
        // model may be self-hosted, so each model is configurable on its own.
        endpointBaseUrl: z.string().max(300).nullable().optional(),
        endpointPath: z.string().max(120).nullable().optional(),
        apiKey: z.string().min(8).max(400).optional(),
        clearApiKey: z.boolean().optional(),
        payloadStyle: z.enum(['openai', 'nemo-rerank']).nullable().optional(),
        params: z
          .object({
            temperature: z.number().min(0).max(2).optional(),
            topP: z.number().min(0).max(1).optional(),
            maxTokens: z.number().int().min(64).max(16000).optional(),
            timeoutMs: z.number().int().min(1000).max(180000).optional(),
          })
          .optional(),
      }),
      req.body,
    );
    const db = getDb();
    const targetModelId = modelIdFrom(req);
    const modelDoc = await db.collection('ai_models').findOne({ modelId: targetModelId });
    if (!modelDoc) throw notFound('Model not registered');
    const update = { updatedAt: new Date() };

    if (data.enabled !== undefined) update.enabled = data.enabled;
    if (data.displayName) update.displayName = data.displayName;
    if (data.params) update.params = { ...(modelDoc.params || {}), ...data.params };

    if (data.endpointBaseUrl !== undefined) {
      update.endpointBaseUrl = data.endpointBaseUrl ? validateBaseUrl(data.endpointBaseUrl) : '';
    }
    if (data.endpointPath !== undefined) {
      update.endpointPath = data.endpointPath ? normalisePath(data.endpointPath) : '';
    }
    if (data.payloadStyle !== undefined) update.payloadStyle = data.payloadStyle || '';
    if (data.clearApiKey) {
      update.apiKeyCipher = '';
      update.apiKeyPreview = '';
    } else if (data.apiKey) {
      update.apiKeyCipher = encryptSecret(data.apiKey);
      update.apiKeyPreview = maskSecret(data.apiKey);
    }

    await db.collection('ai_models').updateOne({ _id: modelDoc._id }, { $set: update });
    invalidateAiCache();
    await logAudit({
      actorId: req.userId,
      action: 'ai.model_updated',
      target: modelDoc.modelId,
      meta: {
        ...data,
        apiKey: data.apiKey ? 'changed' : undefined,
        endpointBaseUrl: update.endpointBaseUrl,
        endpointPath: update.endpointPath,
      },
      ip: req.ip,
    });
    res.json({ ok: true, message: 'Model settings saved. Changes are live without restart.' });
  }),
);

/**
 * Per-model credentials — the "one key per model" view.
 *
 * Every model in the registry gets an entry whether or not it has a key yet, so
 * the admin panel can show six slots and which of them are filled rather than
 * making an operator discover the per-model editor row by row. Keys are
 * write-only: the response carries a masked preview and the source, never the
 * secret, and never the environment value.
 */
router.get(
  '/admin/credentials',
  asyncHandler(async (req, res) => {
    const runtime = await getRuntimeConfig();
    const bundle = await getConfigBundle(true);
    const models = bundle.models
      .filter((m) => !m.retired)
      .map((m) => {
        const rt = runtime.models?.[m.modelId] || {};
        const slot = rt.credentialSlot || m.credentialKey || '';
        return {
          modelId: m.modelId,
          displayName: m.displayName,
          category: m.category,
          enabled: m.enabled !== false,
          credentialSlot: slot,
          // 'model' = saved in the database, 'model-env' = its own environment
          // variable, 'global' = falling back to the shared provider key.
          source: rt.hasStoredKey ? 'model' : rt.hasEnvKey ? 'model-env' : runtime.apiKey ? 'global' : 'none',
          hasOwnKey: Boolean(rt.hasStoredKey || rt.hasEnvKey),
          apiKeyPreview: m.apiKeyPreview || '',
          envConfigured: Boolean(rt.hasEnvKey),
          endpoint: resolveEndpoint(runtime, m).url,
        };
      });
    res.json({
      baseUrl: runtime.baseUrl,
      globalKeyConfigured: Boolean(runtime.apiKey),
      callableSlots: models.length,
      // Eight slots were requested: six models that can be called and two that
      // the provider does not serve. Reporting only six would look like the
      // request was ignored, so the two are listed with the reason.
      slots: CATALOGUE_SLOT_COUNT,
      unavailable: Object.entries(UNAVAILABLE_MODELS).map(([modelId, v]) => ({
        modelId,
        displayName: v.displayName,
        credentialKey: v.credentialKey,
        reason: v.reason,
        // Deliberately false: a key cannot be saved for a model that cannot be
        // called, and accepting one would imply it worked.
        canSetKey: false,
      })),
      configured: models.filter((m) => m.hasOwnKey).length,
      usingGlobal: models.filter((m) => m.source === 'global').length,
      missing: models.filter((m) => m.source === 'none').length,
      models,
    });
  }),
);

/**
 * Set or clear one model's key without touching the others.
 *
 * PATCH /api/ai/admin/credentials/nvidia%2Fnemotron-3.5-parse
 *   { apiKey: 'nvapi-…' }  -> encrypted, used only for that model
 *   { clearApiKey: true }  -> falls back to its env slot, then the global key
 */
router.patch(
  '/admin/credentials/*modelId',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        apiKey: z.string().min(8).max(400).optional(),
        clearApiKey: z.boolean().optional(),
      }),
      req.body,
    );
    if (!data.apiKey && !data.clearApiKey) throw badRequest('Provide apiKey or clearApiKey');
    const raw = req.params.modelId;
    const modelId = Array.isArray(raw) ? raw.join('/') : String(raw || '');
    const db = getDb();
    const model = await db.collection('ai_models').findOne({ modelId });
    if (!model) throw notFound('Model not registered');
    if (model.retired) throw badRequest('This model is retired and cannot be called');

    if (data.clearApiKey) {
      await db.collection('ai_models').updateOne(
        { _id: model._id },
        { $set: { apiKeyCipher: '', apiKeyPreview: '', updatedAt: new Date() } },
      );
    } else {
      await db.collection('ai_models').updateOne(
        { _id: model._id },
        { $set: { apiKeyCipher: encryptSecret(data.apiKey), apiKeyPreview: maskSecret(data.apiKey), updatedAt: new Date() } },
      );
    }
    invalidateAiCache();
    await logAudit({
      actorId: req.userId,
      action: data.clearApiKey ? 'ai.model_key_cleared' : 'ai.model_key_set',
      target: modelId,
      // The key itself is never audited, only that it changed.
      meta: { credentialSlot: model.credentialKey || '', keyChanged: Boolean(data.apiKey) },
      ip: req.ip,
    });
    res.json({ ok: true, modelId, message: data.clearApiKey ? 'Key cleared for this model.' : 'Key saved for this model only.' });
  }),
);

/**
 * The exact URL each model will be called on. Resolved server-side so the admin
 * panel never has to guess, and so a misrouted model (chat model on the rerank
 * path, say) is visible before it fails in a lesson.
 */
router.get(
  '/admin/models/endpoints',
  asyncHandler(async (req, res) => {
    const runtime = await getRuntimeConfig();
    const bundle = await getConfigBundle(true);
    res.json({
      provider: runtime.provider,
      baseUrl: runtime.baseUrl,
      globalKeyConfigured: Boolean(runtime.apiKey),
      modelsConfigured: runtime.modelKeyCount || 0,
      // Resolved straight from the model documents rather than from the active
      // provider: where a model *would* be called is a property of the model,
      // not of whether a key happens to be configured right now.
      endpoints: bundle.models.map((model) => {
        // Resolve against the *runtime* model, whose key is decrypted and whose
        // source is known. Passing the raw document here would hand the resolver
        // the AES blob and make it claim every model has its own key.
        const rtModel = runtime.models?.[model.modelId] || model;
        const ep = resolveEndpoint(runtime, rtModel);
        return {
          modelId: model.modelId,
          displayName: model.displayName,
          category: ep.category,
          method: ep.method,
          baseUrl: ep.baseUrl,
          path: ep.path,
          url: ep.url,
          // 'model' (its own saved key), 'model-env' (its own env slot) or
          // 'global' (the shared provider key). Never just a boolean: "no key"
          // and "borrowing the global key" are very different states.
          apiKeySource: ep.apiKeySource,
          credentialSlot: rtModel.credentialKey || '',
          hasOwnCredentials: ep.hasOwnCredentials,
          configured: ep.apiKeySource !== 'none',
          enabled: model.enabled,
          availability: model.availability || 'unknown',
          apiKeyPreview: model.apiKeyPreview || '',
          overridesGlobal: Boolean(model.endpointBaseUrl || model.apiKeyCipher),
        };
      }),
    });
  }),
);

router.post(
  '/admin/models/endpoints/test',
  asyncHandler(async (req, res) => {
    const data = validate(z.object({ modelId: z.string().min(3).max(160) }), req.body);
    const runtime = await getRuntimeConfig();
    const provider = getProvider(runtime);
    const bundle = await getConfigBundle(true);
    const model = bundle.models.find((m) => m.modelId === data.modelId);
    if (!model) throw notFound('Model not registered');

    // Resolve through the runtime model so a key stored on the model document
    // (or in its own environment slot) is actually the one used for the test.
    const rtModel = runtime.models?.[model.modelId] || model;
    const ep = resolveEndpoint(runtime, rtModel);
    if (!ep.apiKey) {
      return res.status(400).json({
        ok: false,
        modelId: model.modelId,
        endpoint: ep.url,
        credentialSlot: model.credentialKey || '',
        detail:
          'This model has no key of its own and no global key is configured, so the endpoint cannot be tested. The model currently runs on the local analyser.',
      });
    }

    const started = Date.now();
    try {
      if (model.category === 'embedding') {
        const out = await provider.embed({ model: model.modelId, input: ['endpoint check'] });
        return res.json({
          ok: out.vectors.length > 0,
          modelId: model.modelId,
          latencyMs: Date.now() - started,
          endpoint: out.endpoint,
          dimensions: out.vectors[0]?.length || 0,
          detail: out.vectors.length ? 'Embedding endpoint responded' : 'Endpoint responded with no vectors',
        });
      }
      if (model.category === 'rerank') {
        const out = await provider.rerank({ model: model.modelId, query: 'check', documents: ['a', 'b'] });
        return res.json({
          ok: out.results.length > 0,
          modelId: model.modelId,
          latencyMs: Date.now() - started,
          endpoint: out.endpoint,
          detail: 'Rerank endpoint responded',
        });
      }
      const out = await provider.chat({
        model: model.modelId,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        maxTokens: 16,
        temperature: 0,
      });
      return res.json({
        ok: Boolean(out.text),
        modelId: model.modelId,
        latencyMs: Date.now() - started,
        endpoint: out.endpoint,
        sample: String(out.text).slice(0, 80),
        detail: 'Chat endpoint responded',
      });
    } catch (err) {
      // A failed endpoint test is a *finding*, not a failed request.
      //
      // This used to return the upstream status (401/429/504...), so the admin
      // panel surfaced the provider's error as a page-level "Unable to connect.
      // Retry" — which reads like LearnMate is down when the truth is "this key
      // was rejected" or "the model was slow". Report it as a normal 200 payload
      // with ok:false and a category the UI can explain.
      const status = err.status || 502;
      const reason = status === 401 || status === 403 ? 'rejected_key'
        : status === 429 ? 'rate_limited'
        : status === 404 ? 'not_served'
        : status === 408 || status === 504 ? 'timeout'
        : status >= 500 ? 'upstream_error'
        : 'error';
      return res.json({
        ok: false,
        modelId: model.modelId,
        endpoint: ep.url,
        status,
        reason,
        detail: err.message,
        hint:
          reason === 'rejected_key'
            ? 'NVIDIA rejected this key. Check the key for this model (or the global key) and save it again.'
            : reason === 'rate_limited'
              ? 'The key is valid but has hit its rate limit. Give this model its own key to split the quota.'
              : reason === 'not_served'
                ? 'The provider does not serve this model id at this endpoint.'
                : reason === 'timeout'
                  ? 'The model did not answer in time. Large reasoning models can be slow; retry, or route this task to a faster model.'
                  : 'The provider did not answer successfully. The app still works — this model simply could not be verified.',
      });
    }
  }),
);

/** Register an additional model from any provider (provider-independent). */
router.post(
  '/admin/models',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        provider: z.string().min(2).max(40),
        modelId: z.string().min(3).max(160),
        displayName: z.string().min(2).max(120),
        category: z.enum(['chat', 'reasoning', 'embedding', 'rerank', 'parse', 'safety', 'coding']),
        capabilities: z.array(z.string().max(40)).max(12).optional(),
        params: z.object({ temperature: z.number().min(0).max(2).optional(), topP: z.number().min(0).max(1).optional(), maxTokens: z.number().int().min(64).max(16000).optional() }).optional(),
      }),
      req.body,
    );
    const db = getDb();
    const existing = await db.collection('ai_models').findOne({ provider: data.provider, modelId: data.modelId });
    if (existing) throw badRequest('That model is already registered');
    await db.collection('ai_models').insertOne({
      ...data,
      capabilities: data.capabilities || [],
      enabled: true,
      availability: 'unknown',
      validationMessage: 'Not verified yet',
      validatedAt: null,
      createdAt: new Date(),
    });
    invalidateAiCache();
    await logAudit({ actorId: req.userId, action: 'ai.model_registered', target: data.modelId, ip: req.ip });
    res.status(201).json({ ok: true });
  }),
);

/** Task-to-model routing, editable without touching source code. */
router.patch(
  '/admin/routing/:task',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({ model: z.string().min(3).optional(), fallbackModel: z.string().optional(), enabled: z.boolean().optional() }),
      req.body,
    );
    const db = getDb();
    const route = await db.collection('ai_task_routing').findOne({ _id: req.params.task });
    if (!route) throw notFound('Unknown AI task');
    if (data.model) {
      const exists = await db.collection('ai_models').findOne({ modelId: data.model, enabled: true });
      if (!exists) throw badRequest('Assign an enabled model from the registry');
    }
    const update = { updatedAt: new Date() };
    for (const k of ['model', 'fallbackModel', 'enabled']) if (data[k] !== undefined) update[k] = data[k];
    await db.collection('ai_task_routing').updateOne({ _id: req.params.task }, { $set: update });
    invalidateAiCache();
    await logAudit({ actorId: req.userId, action: 'ai.routing_updated', target: req.params.task, meta: data, ip: req.ip });
    res.json({ ok: true });
  }),
);

/** Generation parameters (global defaults + per-task overrides). */
router.put(
  '/admin/generation',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        temperature: z.number().min(0).max(2).optional(),
        topP: z.number().min(0).max(1).optional(),
        maxTokens: z.number().int().min(64).max(16000).optional(),
        stream: z.boolean().optional(),
        jsonMode: z.boolean().optional(),
        taskOverrides: z
          .record(
            z.string(),
            z.object({
              temperature: z.number().min(0).max(2).optional(),
              topP: z.number().min(0).max(1).optional(),
              maxTokens: z.number().int().min(64).max(16000).optional(),
            }),
          )
          .optional(),
      }),
      req.body,
    );
    const db = getDb();
    const cfg = await db.collection('ai_config').findOne({ _id: 'global' });
    const generation = { ...(cfg?.generation || {}) };
    for (const k of ['temperature', 'topP', 'maxTokens', 'stream', 'jsonMode']) {
      if (data[k] !== undefined) generation[k] = data[k];
    }
    const update = { generation, updatedAt: new Date(), updatedBy: req.userId };
    if (data.taskOverrides) update.taskOverrides = { ...(cfg?.taskOverrides || {}), ...data.taskOverrides };
    await db.collection('ai_config').updateOne({ _id: 'global' }, { $set: update }, { upsert: true });
    invalidateAiCache();
    await logAudit({ actorId: req.userId, action: 'ai.generation_updated', meta: data, ip: req.ip });
    res.json({ ok: true, generation });
  }),
);

/** Independent feature toggles. */
router.patch(
  '/admin/features/:feature',
  asyncHandler(async (req, res) => {
    const data = validate(z.object({ enabled: z.boolean() }), req.body);
    await setFeature(req.params.feature, data.enabled, req.userId);
    await logAudit({ actorId: req.userId, action: 'ai.feature_toggled', target: req.params.feature, meta: data, ip: req.ip });
    res.json({ ok: true });
  }),
);

router.get(
  '/admin/usage',
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    res.json(await usageAnalytics({ days }));
  }),
);

router.get(
  '/admin/logs',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const limit = Math.min(200, Number(req.query.limit) || 60);
    const filter = {};
    if (req.query.task) filter.task = req.query.task;
    if (req.query.success !== undefined) filter.success = req.query.success === 'true';
    const logs = await db.collection('ai_usage_logs').find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
    res.json({
      logs: logs.map((l) => ({
        id: String(l._id),
        task: l.task,
        feature: l.feature,
        provider: l.provider,
        model: l.model,
        inputTokens: l.inputTokens,
        outputTokens: l.outputTokens,
        latencyMs: l.latencyMs,
        costUsd: l.costUsd,
        success: l.success,
        error: l.error,
        simulated: Boolean(l.simulated),
        at: l.createdAt,
      })),
    });
  }),
);

/**
 * Vision: read a photo of student work.
 *
 * Body: { image: dataUrl, prompt?, conceptName?, classroomId? }
 *
 * Only models advertising the `vision` capability can be used, and when none is
 * configured or keyed this returns 503 with a reason rather than a fabricated
 * reading — a tutor that invents what it cannot see is worse than one that says
 * it cannot see.
 */
router.post(
  '/vision/read',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        image: z.string().min(64).max(8_000_000),
        prompt: z.string().max(2000).optional(),
        conceptName: z.string().max(200).optional(),
        classroomId: z.string().optional(),
      }),
      req.body,
    );
    const out = await readImage({
      image: data.image,
      prompt: data.prompt,
      conceptName: data.conceptName,
      userId: req.userId,
      classroomId: data.classroomId,
    });
    if (!out.ok) {
      const status = out.code === 'INVALID_IMAGE' ? 400 : out.code === 'NO_CREDENTIALS' || out.code === 'VISION_UNAVAILABLE' ? 503 : 502;
      return res.status(status).json({ error: out.error, code: out.code });
    }
    res.json(out);
  }),
);

/** Which models can see, and what the endpoint can accept. */
router.get(
  '/vision/capabilities',
  asyncHandler(async (req, res) => {
    res.json({
      models: listVisionModels(),
      tasks: await visionTasks(),
      mimeTypes: VISION_MIME_TYPES,
      maxBytes: VISION_MAX_BYTES,
    });
  }),
);

/** Public (authenticated) view: which classroom features are globally available. */
router.get(
  '/features',
  asyncHandler(async (req, res) => {
    const bundle = await getConfigBundle();
    res.json({
      features: Object.values(bundle.flags).map((f) => ({ key: f._id, label: f.label, enabled: f.enabled !== false })),
    });
  }),
);

export default router;
