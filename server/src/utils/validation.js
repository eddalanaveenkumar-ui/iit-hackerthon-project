import { AppError } from './errors.js';

export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request payload', details);
  }
  return result.data;
}

export const toIdString = (v) => (v == null ? null : String(v));

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function average(arr) {
  const vals = arr.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function percentage(part, whole) {
  if (!whole) return 0;
  return round((part / whole) * 100, 1);
}
