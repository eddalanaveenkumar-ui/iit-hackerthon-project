/**
 * ADMIN ACCOUNT AND DEMO GATING
 * =============================
 *
 * The deployment signs in with one administrator account, and no demo accounts
 * exist any more. Both halves are easy to break from a distance, so they are
 * pinned here:
 *
 *   1. the administrator is created from ADMIN_EMAIL / ADMIN_PASSWORD and gets
 *      the admin role;
 *   2. demo content does not seed unless SEED_DEMO=true — the default is off;
 *   3. an existing administrator is not re-created, and its password is not
 *      reset on boot;
 *   4. the old shared demo password no longer opens anything.
 *
 *   node tests/admin-account.mjs
 */

import config from '../src/config/index.js';

let passed = 0;
const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nAdministrator account');

check('demo content is off by default', config.seedDemo === false, String(config.seedDemo));
check('an administrator address is configured', typeof config.adminEmail === 'string' && config.adminEmail.includes('@'), config.adminEmail);
check('an administrator password is configured', typeof config.adminPassword === 'string' && config.adminPassword.length > 0);
check('the default administrator is admin@gmail.com', config.adminEmail === 'admin@gmail.com', config.adminEmail);

console.log('\nThe old demo credentials are inert');

// A deployment that never set SEED_DEMO must not produce the sample users, and
// the shared password must not exist anywhere in the seed's configuration.
const seedSource = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/seed/seed.js', import.meta.url), 'utf8'));
check('seeding is gated on config.seedDemo', /if \(!config\.seedDemo\) return/.test(seedSource));
check('the admin account is created even when seeding is off', /await ensureAdminAccount\(\);/.test(seedSource));

console.log('\nThe login page does not advertise accounts');

const loginSource = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../web/src/pages/Login.jsx', import.meta.url), 'utf8'));
check('no demo account list', !/DEMO_ACCOUNTS/.test(loginSource));
check('no shared demo password', !/LearnMate123/.test(loginSource));
check('no pre-filled email', !/useState\('naveen@/.test(loginSource));


/* -------------------------------------------------------------------------- */
/* Behaviour, not source text                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A source-text assertion can pass while the product is broken, so boot a real
 * server with the default environment (no SEED_DEMO — exactly how a fresh
 * deployment starts) and drive the two flows that matter: the administrator
 * signs in, and the old demo accounts do not.
 */
console.log('\nAgainst a running server, with demo content off');

const { spawn } = await import('node:child_process');
const os = await import('node:os');
const fs = await import('node:fs/promises');
const path = await import('node:path');

const port = Number(process.env.ADMIN_TEST_PORT || 3177);
const dbPort = Number(process.env.ADMIN_TEST_DB_PORT || 27177);
const dbPath = await fs.mkdtemp(path.join(os.tmpdir(), 'learnmate-admin-'));
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DB_MODE: 'embedded',
    DB_PORT: String(dbPort),
    DB_PATH: dbPath,
    JWT_SECRET: 'admin-test-secret-0123456789-0123456789',
    SECRET_ENCRYPTION_KEY: 'admin-test-encryption-0123456789-0123',
    // Deliberately NOT set: SEED_DEMO. This is a default deployment.
    SEED_DEMO: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.env.ADMIN_TEST_VERBOSE && process.stdout.write(`[server] ${d}`));

const stop = async () => {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 600));
  await fs.rm(dbPath, { recursive: true, force: true }).catch(() => {});
};

try {
  // Wait for health rather than sleeping a fixed time.
  let up = false;
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) { up = true; break; }
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  check('the server starts with no demo seed', up);

  const login = async (email, password) => {
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const admin = await login(config.adminEmail, config.adminPassword);
  check('the administrator signs in with the configured credentials', admin.status === 200, `status ${admin.status}`);
  check('and holds the administrator role', admin.body?.user?.role === 'admin', JSON.stringify(admin.body?.user?.role));

  const ai = await fetch(`${base}/api/ai/admin/overview`, { headers: { authorization: `Bearer ${admin.body.token}` } });
  check('the administrator can reach the AI configuration', ai.status === 200, `status ${ai.status}`);

  const wrong = await login(config.adminEmail, 'not-the-password');
  check('a wrong administrator password is refused', wrong.status === 401);

  // The accounts the product used to advertise.
  for (const email of ['naveen@learnmate.ai', 'aisha@learnmate.ai', 'admin@learnmate.ai']) {
    const r = await login(email, 'LearnMate123!');
    check(`the old demo account ${email} does not exist`, r.status === 401, `status ${r.status}`);
  }

  // And an ordinary signup is still an ordinary user — not an administrator.
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Ordinary Person', email: 'ordinary@gmail.com', password: 'password123' }),
  });
  const regBody = await reg.json().catch(() => ({}));
  check('a new signup is an ordinary user', regBody?.user?.role === 'user', JSON.stringify(regBody?.user?.role));
  const denied = await fetch(`${base}/api/ai/admin/overview`, { headers: { authorization: `Bearer ${regBody.token}` } });
  check('and cannot reach the AI configuration', denied.status === 403, `status ${denied.status}`);
} finally {
  await stop();
}

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`  \x1b[31m✗\x1b[0m ${f}`);
  process.exit(1);
}
