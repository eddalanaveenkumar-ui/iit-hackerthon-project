import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../../utils/errors.js';
import { validate } from '../../utils/validation.js';
import { requireAdmin } from '../../middleware/auth.js';
import { encryptSecret, maskSecret, decryptSecret } from '../../utils/crypto.js';
import { logAudit } from '../classrooms/access.js';
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
} from './orchestrator.js';
import { AI_TASKS, FEATURE_DEFINITIONS } from './catalog.js';

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
      models: bundle.models.map(publicModel),
      routing: Object.values(bundle.routes).map(publicRoute),
      features: Object.values(bundle.flags).map(publicFlag),
      tasks: AI_TASKS.map((t) => ({ key: t.key, label: t.label, description: t.description })),
      featureDefinitions: FEATURE_DEFINITIONS,
      updatedAt: cfg.updatedAt || null,
    });
  }),
);

function publicModel(m) {
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

router.patch(
  '/admin/models/:modelId',
  asyncHandler(async (req, res) => {
    const data = validate(
      z.object({
        enabled: z.boolean().optional(),
        displayName: z.string().min(2).max(120).optional(),
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
    const modelDoc = await db.collection('ai_models').findOne({ modelId: req.params.modelId });
    if (!modelDoc) throw notFound('Model not registered');
    const update = { updatedAt: new Date() };
    if (data.enabled !== undefined) update.enabled = data.enabled;
    if (data.displayName) update.displayName = data.displayName;
    if (data.params) update.params = { ...(modelDoc.params || {}), ...data.params };
    await db.collection('ai_models').updateOne({ _id: modelDoc._id }, { $set: update });
    invalidateAiCache();
    await logAudit({ actorId: req.userId, action: 'ai.model_updated', target: modelDoc.modelId, meta: data, ip: req.ip });
    res.json({ ok: true });
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
