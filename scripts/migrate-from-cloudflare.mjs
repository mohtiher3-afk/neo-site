// One-time migration: Cloudflare (D1 + Workers KV) -> Vercel (Postgres + Blob).
//
// Run from the project root, with `wrangler` authenticated (you have been deploying to
// Cloudflare, so `wrangler login` is already set up) and these env vars pointing at the
// NEW Vercel resources:
//
//   DATABASE_URL          Vercel Postgres connection string
//   BLOB_READ_WRITE_TOKEN Vercel Blob token (project settings -> Storage)
//   CLOUDFLARE_API_TOKEN  optional; if unset, wrangler uses your browser login
//
//   npx wrangler          # one-time, makes the CLI available to this script
//   node scripts/migrate-from-cloudflare.mjs
//
// It is safe to re-run: every write is INSERT ... ON CONFLICT DO NOTHING, and blobs are
// uploaded with the same key the app uses for deletes.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { put as blobPut } from '@vercel/blob';

const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

const config = JSON.parse(readFileSync('wrangler.json', 'utf8'));
const dbName = config.d1_databases.find((d) => d.binding === 'DB')?.database_name
  || config.d1_databases[0]?.database_name;
const kvId = config.kv_namespaces.find((k) => k.binding === 'MEDIA')?.id
  || config.kv_namespaces[0]?.id;
if (!dbName || !kvId) throw new Error('Could not find the DB / MEDIA bindings in wrangler.json.');

const blobToken = need('BLOB_READ_WRITE_TOKEN');
const db = new Pool({ connectionString: need('DATABASE_URL') });

// --- Cloudflare readers (shell out to wrangler, parse defensively) -------------
function sh(args, { base64 = false } = {}) {
  const out = execFileSync('wrangler', args, {
    encoding: 'utf8',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || '' },
  });
  if (base64) return Buffer.from(out.trim(), 'base64');
  // wrangler may emit a leading newline / warnings; start parsing at the first [ or {
  const s = out.search(/[[{]/);
  return JSON.parse(out.slice(s === -1 ? 0 : s));
}

// d1 execute --json prints [{ success, data:{ results }, meta }]
async function d1Select(table) {
  const out = sh(['d1', 'execute', dbName, '--command', `SELECT * FROM ${table}`, '--json']);
  const step = Array.isArray(out) ? out[0] : out;
  if (!step?.success) return null; // e.g. "no such table" -> skip
  return step.data?.results ?? [];
}

function kvList(prefix) {
  const out = sh(['kv', 'key', 'list', kvId, '--prefix', prefix, '--json']);
  const step = Array.isArray(out) ? out[0] : out;
  return (step?.data ?? []).map((e) => e.name ?? e.key).filter(Boolean);
}

function kvGet(key) {
  return sh(['kv', 'key', 'get', kvId, key, '--base64'], { base64: true });
}

// --- Step 1: upload KV media to Vercel Blob, key -> url ----------------------
async function migrateBlobs() {
  const urlByKey = {};
  for (const prefix of ['audio:', 'cover:']) {
    const keys = kvList(prefix);
    for (const key of keys) {
      const buf = kvGet(key);
      const info = await blobPut(key, buf, { token: blobToken, upsert: true });
      urlByKey[key] = info.url;
      console.log(`  blob  ${prefix === 'audio:' ? 'audio' : 'cover'}:${key.slice(prefix.length)}  (${buf.length} B)`);
    }
    console.log(`  ${prefix} uploaded ${keys.length} object(s)`);
  }
  return urlByKey;
}

// --- Step 2: apply the Postgres schema ---------------------------------------
function applySchema() {
  const sql = readFileSync('db/schema.sql', 'utf8');
  db.query(sql); // node-pg runs a multi-statement string on the simple protocol
}

// --- Step 3: copy D1 rows into Postgres --------------------------------------
const TABLES = [
  'quota', 'deleting_tracks', 'upload_sessions', 'visitors',
  'owner', 'tiktok_connection', 'tiktok_feed_cache', 'tiktok_oauth_states',
];

async function insertPlain(table) {
  const rows = await d1Select(table);
  if (!rows || rows.length === 0) return 0;
  const cols = Object.keys(rows[0]);
  const values = rows.map(() => cols.map((c, i) => `$${i + 1}`).join(', '));
  const client = await db.connect();
  let n = 0;
  try {
    for (const r of rows) {
      await client.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values[0]}) ON CONFLICT DO NOTHING`,
        cols.map((c) => r[c])
      );
      n++;
    }
  } finally {
    client.release();
  }
  return n;
}

async function insertTracks(urlByKey) {
  const rows = await d1Select('tracks');
  if (!rows) return 0;
  const client = await db.connect();
  try {
    for (const r of rows) {
      await client.query(
        `INSERT INTO tracks
           (id, title, artist, size_bytes, content_type, extension, created_at, available_at,
            published, audio_version, cover_version, audio_url, cover_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id, r.title, r.artist, Number(r.size_bytes), r.content_type, r.extension,
          r.created_at, Number(r.available_at), Number(r.published || 0),
          Number(r.audio_version || 1), Number(r.cover_version || 0),
          urlByKey[`audio:${r.id}`] ?? '', urlByKey[`cover:${r.id}`] ?? null,
        ]
      );
    }
    return rows.length;
  } finally {
    client.release();
  }
}

// --- run ----------------------------------------------------------------------
console.log('Step 1/3 — uploading Cloudflare KV media to Vercel Blob…');
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
console.log('\nDone. Verify: `GET /api/tracks` should list the migrated releases.');
