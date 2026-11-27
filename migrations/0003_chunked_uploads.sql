-- Session state for chunked audio uploads (resume + expiry).
-- Note: no current function writes to this table; it is part of the live schema.
CREATE TABLE upload_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    content_type TEXT NOT NULL,
    extension TEXT NOT NULL CHECK (extension IN ('mp3', 'm4a', 'wav')),
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL CHECK (chunk_count > 0),
    next_chunk INTEGER NOT NULL DEFAULT 0 CHECK (next_chunk >= 0),
    finalized_chunks INTEGER NOT NULL DEFAULT 0 CHECK (finalized_chunks >= 0),
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1))
);
CREATE INDEX upload_sessions_expiry ON upload_sessions (expires_at);
