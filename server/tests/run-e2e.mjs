/**
 * Reproducible E2E harness.
 *
 * Boots a throwaway server instance (fresh database directory + its own port),
 * waits for health, runs tests/e2e.mjs against it, prints the result and shuts
 * everything down. Each run starts from seeded demo data, so the suite is
 * idempotent and safe to run repeatedly.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const port = Number(process.env.E2E_PORT || 3111);
const dbPort = Number(process.env.E2E_DB_PORT || 27111);
const dbPath = await fs.mkdtemp(path.join(os.tmpdir(), 'learnmate-e2e-'));
const baseUrl = `http://127.0.0.1:${port}`;

console.log(`[e2e] fresh database at ${dbPath}`);
const server = spawn(process.execPath, ['src/index.js'], {
  cwd: serverDir,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DB_MODE: 'embedded',
    DB_PORT: String(dbPort),
    DB_PATH: dbPath,
    // The suite exercises many AI-backed flows as a single user in under a
    // minute, which is more than a real learner generates. Raise the ceiling for
    // the test run only, so a legitimate limit does not read as a broken app.
    AI_RATE_LIMIT_MAX: '10000',
    SEED_DEMO: 'true',
    JWT_SECRET: 'e2e-secret-key-0123456789-0123456789',
    SECRET_ENCRYPTION_KEY: 'e2e-encryption-key-0123456789-0123456789',
    APP_URL: baseUrl,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[server] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[server:err] ${d}`));

async function waitForHealth(timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        const body = await res.json();
        if (body.ok) return body;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not become healthy in time');
}

let exitCode = 1;
try {
  const health = await waitForHealth();
  console.log(`[e2e] server healthy (db: ${health.db.mode}) — running suite\n`);
  const test = spawn(process.execPath, ['tests/e2e.mjs'], {
    cwd: serverDir,
    env: { ...process.env, BASE_URL: baseUrl },
    stdio: 'inherit',
  });
  exitCode = await new Promise((resolve) => test.on('close', (code) => resolve(code ?? 1)));
} catch (err) {
  console.error('[e2e] harness error:', err.message);
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (!server.killed) server.kill('SIGKILL');
  await fs.rm(dbPath, { recursive: true, force: true }).catch(() => {});
}
process.exit(exitCode);
