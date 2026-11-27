-- Lock for in-flight track deletions (KV blob removal pending).
-- Note: no current function writes to this table; it is part of the live schema.
CREATE TABLE deleting_tracks (
    track_id TEXT PRIMARY KEY NOT NULL,
    created_at INTEGER NOT NULL
);
