/**
 * Boots a throwaway server (fresh embedded database, its own port), waits for
 * health, runs tests/tracs-live.mjs, then shuts everything down.
 *
 * Mirrors tests/run-e2e.mjs so the tracs suite needs no manual setup.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const port = Number(process.env.TRACS_PORT || 3199);
const dbPort = Number(process.env.TRACS_DB_PORT || 27199);
const dbPath = await fs.mkdtemp(path.join(os.tmpdir(), 'learnmate-tracs-'));
const baseUrl = `http://127.0.0.1:${port}`;

console.log(`[tracs] fresh database at ${dbPath}`);
const server = spawn(process.execPath, ['src/index.js'], {
  cwd: serverDir,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DB_MODE: 'embedded',
    DB_PORT: String(dbPort),
    DB_PATH: dbPath,
    AI_RATE_LIMIT_MAX: '10000',
    SEED_DEMO: 'true',
    JWT_SECRET: 'tracs-secret-key-0123456789-0123456789',
    SECRET_ENCRYPTION_KEY: 'tracs-encryption-key-0123456789-0123456789',
    APP_URL: baseUrl,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.env.TRACS_VERBOSE && process.stdout.write(`[server] ${d}`));
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
  await waitForHealth();
  console.log(`[tracs] server healthy — running suite\n`);
  const test = spawn(process.execPath, ['tests/tracs-live.mjs'], {
    cwd: serverDir,
    env: { ...process.env, BASE_URL: baseUrl },
    stdio: 'inherit',
  });
  exitCode = await new Promise((resolve) => test.on('close', (code) => resolve(code ?? 1)));
} catch (err) {
  console.error('[tracs] harness error:', err.message);
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  if (!server.killed) server.kill('SIGKILL');
  await fs.rm(dbPath, { recursive: true, force: true }).catch(() => {});
}
process.exit(exitCode);
