// One-time, self-healing bootstrap: create the Postgres tables if missing.
// Vercel Postgres ships empty, so db/schema.sql must be applied once before the
// API can read or write. This function does that using the project's own
// DATABASE_URL.
//
//   GET /api/setup -> reports which expected tables exist, and creates any that
//                     are missing. Idempotent: once the tables exist it only
//                     runs a cheap read, so it is safe to call repeatedly.
//
// It only ever creates this app's own empty schema — no data, no secrets — so
// once it has succeeded you may delete this file and re-deploy to remove the
// endpoint entirely.
import { json, fail, query } from '../lib/vercel/shared.js';

const EXPECTED_TABLES = [
  'tracks',
  'quota',
  'deleting_tracks',
  'upload_sessions',
  'visitors',
  'owner',
  'tiktok_connection',
  'tiktok_feed_cache',
  'tiktok_oauth_states',
];

// Mirrors db/schema.sql. Embedded here so the bootstrap never depends on the
// function's filesystem layout (no readFileSync, no CWD assumptions).
const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
    artist TEXT NOT NULL CHECK (char_length(artist) BETWEEN 1 AND 100),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 33554432),
    content_type TEXT NOT NULL CHECK (content_type IN ('audio/mpeg', 'audio/mp4', 'audio/wav')),
    extension TEXT NOT NULL CHECK (extension IN ('mp3', 'm4a', 'wav')),
    created_at TEXT NOT NULL,
    available_at BIGINT NOT NULL,
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
    audio_version BIGINT NOT NULL DEFAULT 1,
    cover_version BIGINT NOT NULL DEFAULT 0,
    audio_url TEXT NOT NULL,
    cover_url TEXT
);
CREATE INDEX IF NOT EXISTS tracks_public_ready ON tracks (published, available_at, created_at DESC);

CREATE TABLE IF NOT EXISTS quota (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    used_bytes BIGINT NOT NULL DEFAULT 0 CHECK (used_bytes >= 0)
);

CREATE TABLE IF NOT EXISTS deleting_tracks (
    track_id TEXT PRIMARY KEY NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    content_type TEXT NOT NULL,
    extension TEXT NOT NULL CHECK (extension IN ('mp3', 'm4a', 'wav')),
    created_at TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    chunk_count INTEGER NOT NULL CHECK (chunk_count > 0),
    next_chunk INTEGER NOT NULL DEFAULT 0 CHECK (next_chunk >= 0),
    finalized_chunks INTEGER NOT NULL DEFAULT 0 CHECK (finalized_chunks >= 0),
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1))
);
CREATE INDEX IF NOT EXISTS upload_sessions_expiry ON upload_sessions (expires_at);

CREATE TABLE IF NOT EXISTS visitors (
    visitor_id TEXT PRIMARY KEY NOT NULL,
    first_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS visitors_first_seen ON visitors (first_seen);

CREATE TABLE IF NOT EXISTS owner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    email TEXT NOT NULL UNIQUE,
    claimed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tiktok_connection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token_payload TEXT NOT NULL,
    access_expires_at BIGINT NOT NULL,
    refresh_expires_at BIGINT NOT NULL,
    open_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    profile_url TEXT,
    updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tiktok_feed_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload_json TEXT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tiktok_oauth_states (
    state_hash TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS tiktok_oauth_states_expiry ON tiktok_oauth_states (expires_at);
`;

async function status() {
  const { rows } = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const have = new Set(rows.map((row) => row.table_name));
  const present = EXPECTED_TABLES.filter((table) => have.has(table));
  const missing = EXPECTED_TABLES.filter((table) => !have.has(table));
  return { present, missing, complete: missing.length === 0 };
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return fail('DATABASE_URL is not set in this project.', 503);
  }
  try {
    let result = await status();
    if (!result.complete) {
      await query(SCHEMA_DDL);
      result = { created: true, ...(await status()) };
    }
    return json(result);
  } catch (error) {
    return fail(`setup failed: ${error.message}`, 500);
  }
}
