-- Owner claim + TikTok display/connection tables and their OAuth state.
-- Note: no current function in this repo writes to these tables; they are part of the live schema.
CREATE TABLE owner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    email TEXT NOT NULL UNIQUE,
    claimed_at TEXT NOT NULL
);

CREATE TABLE tiktok_connection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token_payload TEXT NOT NULL,
    access_expires_at INTEGER NOT NULL,
    refresh_expires_at INTEGER NOT NULL,
    open_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    profile_url TEXT,
    updated_at INTEGER NOT NULL
);

CREATE TABLE tiktok_feed_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE tiktok_oauth_states (
    state_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX tiktok_oauth_states_expiry ON tiktok_oauth_states (expires_at);
