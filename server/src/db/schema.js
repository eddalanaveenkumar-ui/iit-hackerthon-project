import { getDb } from './index.js';
import { SCHEMAS } from './schemas.js';

let ensured = false;

/** Creates the documented indexes for every collection. Idempotent. */
export async function ensureIndexes(log = console.log) {
  if (ensured) return;
  const db = getDb();
  let count = 0;
  for (const [, def] of Object.entries(SCHEMAS)) {
    const col = db.collection(def.collection);
    for (const idx of def.indexes || []) {
      try {
        await col.createIndex(idx.keys, { name: idx.name, ...idx.options });
        count += 1;
      } catch (err) {
        log(`[db] index warning on ${def.collection}: ${err.message}`);
      }
    }
  }
  ensured = true;
  log(`[db] ${count} indexes ready across ${Object.keys(SCHEMAS).length} collections`);
}
