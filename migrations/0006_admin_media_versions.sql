-- Media lives in Workers KV (free plan). Versions are timestamps used for cache-busting URLs.
-- cover_version = 0 means the track has no cover.
ALTER TABLE tracks ADD COLUMN audio_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tracks ADD COLUMN cover_version INTEGER NOT NULL DEFAULT 0;
