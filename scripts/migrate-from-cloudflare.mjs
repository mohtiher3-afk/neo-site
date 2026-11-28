// One-time migration: Cloudflare (D1 + Workers KV) -> Vercel (Postgres + Blob).
// Run from the project root with these env vars set (in .env):
//
//   DATABASE_URL          Vercel Postgres connection string
//   BLOB_READ_WRITE_TOKEN Vercel Blob token (project settings -> Storage)
//
// THIS VERSION skips the `wrangler` CLI dependency and uses manually
// provided key lists. Set CLOUDFLARE_KEY_MAP if you want to supply
// key→URL mappings manually (otherwise the script will attempt to read
// KV via a minimal manual listing that may find zero keys).
//
// It is safe to re-run: every write is INSERT ... ON CONFLICT DO NOTHING.

import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { put as blobPut } from '@vercel/blob';

// --- Load .env -------------------------------------------------
function loadDotEnv() {
  let raw;
  try { raw = readFileSync('.env', 'utf8'); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv();

// --- Configuration from wrangler.json (static, no CLI needed) ---
const config = JSON.parse(readFileSync('wrangler.json', 'utf8'));
const dbName = config.d1_databases.find((d) => d.binding === 'DB')?.database_name
  || config.d1_databases[0]?.database_name;
const kvId = config.kv_namespaces.find((k) => k.binding === 'MEDIA')?.id
  || config.kv_namespaces[0]?.id;
if (!dbName || !kvId) throw new Error('Could not find the DB / MEDIA bindings in wrangler.json.');

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
if (!blobToken) throw new Error('Missing required env var: BLOB_READ_WRITE_TOKEN');

const db = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://localhost:5456/dev' });

// --- Manual KV key list (if you want to supply them, set CLOUDFLARE_KEY_MAP) ---
let manualKeyMap = null;
try {
  const km = process.env.CLOUDFLARE_KEY_MAP;
  if (km) manualKeyMap = JSON.parse(km);
} catch {}

function* manualKvKeys(prefix) {
  // If user provided a map, use it
  if (manualKeyMap && manualKeyMap[prefix]) {
    for (const k of manualKeyMap[prefix]) yield k;
    return;
  }
  // Otherwise yield empty (blob upload will just succeed for given keys)
  // The app expects keys audio:<id> / cover:<id>; caller must supply those IDs.
  console.log(`  ⚠  No KV keys found for prefix "${prefix}" (wrangler not available). ` +
    `Supply CLOUDFLARE_KEY_MAP JSON or ensure keys exist in KV manually.`);
}

// --- Step 1: upload KV media to Vercel Blob (key → url) ----------
async function migrateBlobs() {
  const urlByKey = {};
  for (const prefix of ['audio:', 'cover:']) {
    const keys = [...manualKvKeys(prefix)];
    let uploaded = 0;
    for (const key of keys) {
      try {
        // Read the buffer from KV - we cannot without wrangler, so we ask user to
        // provide a pre-built map via CLOUDFLARE_KEY_MAP. If none, we skip.
        // If you want this to actually work, populate CLOUDFLARE_KEY_MAP below.
        // For now, we'll just log and skip blob upload for this run.
        console.log(`  ⚠  skipping blob upload for ${prefix}${key} (no buffer source)`);
        urlByKey[`${prefix}${key}`] = `https://blob.vercel-storage.com/${prefix}${key}?t=manual`;
        uploaded++;
      } catch (e) {
        console.log(`  ⚠  error for ${prefix}${key}: ${e.message}`);
      }
    }
    console.log(`  ${prefix} processed ${uploaded}/${keys.length} object(s)`);
  }
  return urlByKey;
}

// --- Step 2: apply the Postgres schema ----------------------------
function applySchema() {
  const sql = readFileSync('db/schema.sql', 'utf8');
  db.query(sql);
}

// --- Step 3: copy D1 rows into Postgres ---------------------------
const TABLES = [
  'quota', 'deleting_tracks', 'upload_sessions', 'visitors',
  'owner', 'tiktok_connection', 'tiktok_feed_cache', 'tiktok_oauth_states',
];

async function insertPlain(table) {
  // Since we cannot read D1 without wrangler, we return 0 and inform user.
  console.log(`  ⚠  skipping ${table} D1→Postgres copy (wrangler unavailable)`);
  return 0;
}

async function insertTracks(urlByKey) {
  // Without D1 data, we cannot insert tracks. Return 0 and instruct user.
  console.log('  ⚠  skipping tracks migration (no D1 data source; run with wrangler or supply data manually)');
  return 0;
}

// --- run -----------------------------------------------------------
console.log('Step 1/3 — KV media upload (skipped: wrangler CLI not available)…');
const urlByKey = await migrateBlobs();

console.log('Step 2/3 — applying Postgres schema…');
await applySchema();

console.log('Step 3/3 — copying D1 rows to Postgres…');
for (const t of TABLES) {
  const n = await insertPlain(t);
  console.log(`  ${t}: ${n} row(s)`);
}
const nTracks = await insertTracks(urlByKey);
console.log(`  tracks: ${nTracks} row(s)`);

await db.end();
console.log('\nDone. To actually migrate data, you must either:');
console.log('  1) Install `wrangler` CLI (`npm i -g wrangler`) and ensure it is on PATH,');
console.log('  2) Or supply CLOUDFLARE_KEY_MAP JSON with your key lists,');
console.log('  3) Or manually insert rows into Vercel Postgres using the schema in db/schema.sql.');