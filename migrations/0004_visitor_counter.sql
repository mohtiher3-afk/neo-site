-- Anonymous visitor counting (used by GET /api/visitors, keyed by the neo_vid cookie).
CREATE TABLE visitors (
    visitor_id TEXT PRIMARY KEY NOT NULL,
    first_seen TEXT NOT NULL
);
CREATE INDEX visitors_first_seen ON visitors (first_seen);
