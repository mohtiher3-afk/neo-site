-- NEO Music schema for Vercel Postgres (port of the Cloudflare D1 migrations 0001–0006).
-- Apply it to the new Vercel Postgres database before running scripts/migrate-from-cloudflare.mjs.
--
-- Differences from the D1 (SQLite) schema:
--   * media now lives in Vercel Blob, so tracks stores the blob URLs (audio_url / cover_url)
--     and the API 307-redirects /api/media/* to them instead of proxying bytes.
--   * ms-epoch values use BIGINT; everything else mirrors the original DDL.

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
