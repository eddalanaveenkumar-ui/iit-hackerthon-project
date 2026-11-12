import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../../..');

dotenv.config({ path: path.join(ROOT, '.env') });
dotenv.config({ path: path.join(ROOT, 'server/.env') });

const bool = (v, d = false) => (v === undefined ? d : String(v).toLowerCase() === 'true');
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 3001),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  root: ROOT,

  db: {
    mode: process.env.DB_MODE || 'embedded', // 'embedded' | 'external'
    uri: process.env.MONGODB_URI || '',
    name: process.env.MONGODB_DB || 'learnmate',
    path: path.isAbsolute(process.env.DB_PATH || '')
      ? process.env.DB_PATH
      : path.join(ROOT, process.env.DB_PATH || 'server/.data/learnmate'),
    port: num(process.env.DB_PORT, 27017),
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || 'learnmate-dev-insecure-secret-change-me',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    bcryptRounds: 10,
  },

  security: {
    // Used to encrypt provider API keys at rest (AES-256-GCM).
    secretKey: process.env.SECRET_ENCRYPTION_KEY || 'learnmate-dev-encryption-key-change-me-please-32',
  },

  ai: {
    nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
    nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    // Must stay comfortably below the serverless function budget
    // (vercel.json maxDuration, 120s). When these were equal at 60s, a slow
    // upstream produced a gateway 504 instead of our own error — the request
    // died at the platform edge with no diagnosis, and the chat turn looked
    // broken rather than slow.
    requestTimeoutMs: num(process.env.AI_REQUEST_TIMEOUT_MS, 30000),
    maxRetries: num(process.env.AI_MAX_RETRIES, 2),
    // When no NVIDIA key is configured the platform runs the deterministic
    // local adapter so every workflow remains testable end to end.
    allowSimulation: bool(process.env.AI_ALLOW_SIMULATION, true),
    // Per-model credential slots. Each model resolves its own key first (see
    // ai/config-store.js), so quotas can be split without a redeploy. This map
    // exists for deployments that prefer one generic variable per model id over
    // the named NVIDIA_API_KEY_* slots in the catalogue.
    modelKeys: {},
  },

  seedDemo: bool(process.env.SEED_DEMO, true),
  uploadDir: path.join(ROOT, 'server/.data/uploads'),
};

export default config;
