-- Base schema for the NEO Music site.
-- Track metadata + the free-plan KV storage quota ledger.
CREATE TABLE tracks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
    artist TEXT NOT NULL CHECK (length(artist) BETWEEN 1 AND 100),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 33554432),
    content_type TEXT NOT NULL CHECK (content_type IN ('audio/mpeg', 'audio/mp4', 'audio/wav')),
    extension TEXT NOT NULL CHECK (extension IN ('mp3', 'm4a', 'wav')),
    created_at TEXT NOT NULL,
    available_at INTEGER NOT NULL,
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1))
);
CREATE INDEX tracks_public_ready ON tracks (published, available_at, created_at DESC);

CREATE TABLE quota (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0)
);
