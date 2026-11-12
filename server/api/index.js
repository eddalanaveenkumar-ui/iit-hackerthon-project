/**
 * Vercel serverless entrypoint.
 *
 * `src/index.js` is the long-running server (it calls app.listen). Vercel needs
 * a module that *returns* the Express app, so this file adapts it.
 *
 * Initialisation (DB connect, indexes, AI catalogue bootstrap, demo seed) is
 * memoised in a module-scope promise: serverless can freeze and reuse the
 * container, so this runs once per cold start rather than on every request.
 * If it rejects, the promise is cleared so the next request retries instead of
 * caching a permanent failure.
 */
import { createApp } from '../src/app.js';

const app = createApp();

let readyPromise = null;

function label(step) {
  return `[vercel] ${step}`;
}

async function initialise() {
  const config = (await import('../src/config/index.js')).default;
  const { connectDb } = await import('../src/db/index.js');
  const { ensureIndexes } = await import('../src/db/schema.js');
  const { bootstrapAiCatalog } = await import('../src/modules/ai/config-store.js');

  if (config.db.mode !== 'external') {
    // The embedded engine spawns a native MongoDB binary, which cannot run in a
    // serverless function. Fail loudly and specifically instead of crashing
    // deep inside the driver.
    throw new Error(
      'DB_MODE must be "external" when running on Vercel. Set DB_MODE=external and MONGODB_URI for this project.',
    );
  }
  if (!config.db.uri) {
    throw new Error('MONGODB_URI is not set for this deployment.');
  }

  await connectDb();
  await ensureIndexes();
  await bootstrapAiCatalog();

  if (config.seedDemo) {
    const { ensureSeed } = await import('../src/seed/seed.js');
    await ensureSeed().catch((err) => console.error(label('seed skipped'), err.message));
  }
}

function ensureReady() {
  if (!readyPromise) {
    readyPromise = initialise().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

export default async function handler(req, res) {
  try {
    await ensureReady();
  } catch (err) {
    console.error(label('initialisation failed'), err);
    res.status(503).json({
      error: {
        code: 'INIT_FAILED',
        message: 'The API could not start. Check DB_MODE, MONGODB_URI and the MongoDB Atlas network allowlist.',
        details: process.env.NODE_ENV === 'production' ? undefined : err.message,
      },
    });
    return;
  }
  return app(req, res);
}
