/**
 * Migration regression: retiring unavailable models.
 *
 * The catalogue seed is only inserted when a record is *missing*, so a
 * deployment created before a model was found to be unavailable keeps serving it
 * forever. This reproduces that state directly — a live database holding the old
 * eight-model registry with routes pointing at the two dead models — runs the
 * bootstrap again, and asserts the deployment heals without data loss.
 *
 * Run: node tests/migration.mjs
 */
import assert from 'node:assert/strict';

process.env.DB_MODE = 'embedded';
process.env.PORT = process.env.PORT || '3499';
process.env.DB_PATH = `/tmp/learnmate-migration-${process.pid}`;

const { connectDb, closeDb, getDb } = await import('../src/db/index.js');
const { bootstrapAiCatalog } = await import('../src/modules/ai/config-store.js');
const { MODEL_REGISTRY_SEED, RETIRED_MODELS } = await import('../src/modules/ai/catalog.js');

let pass = 0;
const fails = [];
const check = (label, fn) => {
  try {
    fn();
    pass += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${label}`);
  } catch (err) {
    fails.push(label);
    console.log(`  \u001b[31m✗\u001b[0m ${label}\n      ${err.message}`);
  }
};

await connectDb();
const db = getDb();
await db.collection('ai_models').deleteMany({});
await db.collection('ai_task_routing').deleteMany({});

// --- Simulate the pre-fix deployment -------------------------------------
const STALE = [
  { modelId: 'nvidia/nemotron-content-safety-reasoning-4b', category: 'safety', enabled: true },
  { modelId: 'qwen/qwen2.5-coder-32b-instruct', category: 'coding', enabled: true },
  { modelId: 'deepseek-ai/deepseek-v4-flash', category: 'chat', enabled: true },
  { modelId: 'nvidia/nemotron-3.5-lightning-30b-a3b', category: 'chat', enabled: true },
];
for (const m of STALE) {
  await db.collection('ai_models').insertOne({
    provider: 'nvidia',
    displayName: m.modelId,
    availability: 'unknown',
    createdAt: new Date(),
    ...m,
  });
}
await db.collection('ai_task_routing').insertMany([
  { _id: 'code_analysis', task: 'code_analysis', model: 'qwen/qwen2.5-coder-32b-instruct', fallbackModel: 'nvidia/nemotron-3-ultra-550b-a55b', enabled: true },
  { _id: 'practical_detection', task: 'practical_detection', model: 'qwen/qwen2.5-coder-32b-instruct', fallbackModel: '', enabled: true },
  { _id: 'moderation', task: 'moderation', model: 'nvidia/nemotron-content-safety-reasoning-4b', fallbackModel: '', enabled: true },
  { _id: 'tutoring', task: 'tutoring', model: 'deepseek-ai/deepseek-v4-flash', fallbackModel: '', enabled: true },
]);

console.log('\n\u001b[1mBefore bootstrap (simulated legacy deployment)\u001b[0m');
const staleRoutes = await db.collection('ai_task_routing').find({}).toArray();
check('legacy database has routes pointing at unavailable models', () => {
  // qwen (x2), content-safety, and the pre-rename deepseek-v4-flash.
  const dead = staleRoutes.filter((r) => RETIRED_MODELS[r.model]);
  assert.equal(dead.length, 4, `expected 4 dead routes, found ${dead.length}`);
});

// --- Run the migration ---------------------------------------------------
await bootstrapAiCatalog();

console.log('\n\u001b[1mAfter bootstrap\u001b[0m');
const models = await db.collection('ai_models').find({}).toArray();
const routes = await db.collection('ai_task_routing').find({}).toArray();
const liveIds = new Set(models.filter((m) => !m.retired).map((m) => m.modelId));

check('retired models are kept for history but disabled', () => {
  const qwen = models.find((m) => m.modelId === 'qwen/qwen2.5-coder-32b-instruct');
  const safety = models.find((m) => m.modelId === 'nvidia/nemotron-content-safety-reasoning-4b');
  assert.ok(qwen && safety, 'retired documents must not be deleted');
  for (const m of [qwen, safety]) {
    assert.equal(m.retired, true, `${m.modelId} should be retired`);
    assert.equal(m.enabled, false, `${m.modelId} should be disabled`);
    assert.equal(m.availability, 'unavailable');
    assert.ok(m.validationMessage?.length > 10, `${m.modelId} should explain why`);
  }
});

check('every callable seed model is present', () => {
  for (const seed of MODEL_REGISTRY_SEED) {
    assert.ok(liveIds.has(seed.modelId), `${seed.modelId} missing from the live registry`);
  }
});

check('no task routes at a retired or missing model', () => {
  const dangling = routes.filter((r) => r.model && !liveIds.has(r.model));
  assert.deepEqual(dangling.map((d) => d.task), [], `dangling routes: ${dangling.map((d) => d.task).join(', ')}`);
});

check('code analysis moved off the retired coder model', () => {
  const r = routes.find((x) => x.task === 'code_analysis');
  assert.equal(r.model, 'nvidia/nemotron-3-ultra-550b-a55b');
});

check('moderation moved off the retired safety model', () => {
  const r = routes.find((x) => x.task === 'moderation');
  assert.equal(r.model, 'nvidia/nemotron-3.5-lightning-30b-a3b');
});

check('the renamed DeepSeek id was migrated in place', () => {
  const r = routes.find((x) => x.task === 'tutoring');
  assert.equal(r.model, 'deepseek-ai/deepseek-v4.1-flash', 'v4-flash should be rewritten to v4.1-flash');
  assert.equal(models.filter((m) => m.modelId === 'deepseek-ai/deepseek-v4-flash' && !m.retired).length, 0);
});

check('a fallback pointing at a retired model is also re-pointed', () => {
  for (const r of routes) {
    if (!r.fallbackModel) continue;
    assert.ok(liveIds.has(r.fallbackModel), `${r.task} fallback ${r.fallbackModel} is not callable`);
  }
});

// Idempotency: a second boot must not churn records or duplicate anything.
await bootstrapAiCatalog();
const modelsAgain = await db.collection('ai_models').find({}).toArray();
check('second run changes nothing', () => {
  assert.equal(modelsAgain.length, models.length);
  assert.equal(modelsAgain.filter((m) => m.retired).length, models.filter((m) => m.retired).length);
});

await closeDb();
const fs = await import('node:fs/promises');
await fs.rm(process.env.DB_PATH, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fails.length} failed\n`);
if (fails.length) process.exitCode = 1;
