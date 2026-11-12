import config from './config/index.js';
import { connectDb, closeDb } from './db/index.js';
import { ensureIndexes } from './db/schema.js';
import { bootstrapAiCatalog } from './modules/ai/config-store.js';
import { createApp } from './app.js';

async function main() {
  console.log('[learnmate] starting…');
  await connectDb();
  console.log('[learnmate] database ready', config.db.mode);
  await ensureIndexes();
  await bootstrapAiCatalog();

  if (config.seedDemo) {
    const { ensureSeed } = await import('./seed/seed.js');
    await ensureSeed();
  }

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[learnmate] API listening on http://0.0.0.0:${config.port}`);
  });

  const shutdown = async (signal) => {
    console.log(`[learnmate] ${signal} received, shutting down`);
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[learnmate] fatal startup error', err);
  process.exit(1);
});
