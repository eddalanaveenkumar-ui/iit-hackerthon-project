import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length = 8) {
  let out = '';
  const bytes = crypto.randomBytes(length * 2);
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Human-friendly, unique classroom id e.g. LM-7KQ4-9XZ2 */
export function generateClassroomCode() {
  return `LM-${randomCode(4)}-${randomCode(4)}`;
}

export function generateJoinCode() {
  return randomCode(8);
}

export function uuid() {
  return crypto.randomUUID();
}

export function now() {
  return new Date();
}

export function minutesAgo(n) {
  return new Date(Date.now() - n * 60_000);
}

export function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000);
}
