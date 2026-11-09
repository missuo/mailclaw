-- One-time upgrade for deployments on the v2 protocol, adding server-side AI
-- enrichment (summary + translation generated at ingest) and user settings.
-- Fresh installs get all of this from schema.sql; do not run this twice
-- (SQLite has no ADD COLUMN IF NOT EXISTS, so a re-run fails on the first ALTER).
ALTER TABLE emails ADD COLUMN summary TEXT;
ALTER TABLE emails ADD COLUMN summary_lang TEXT;
ALTER TABLE emails ADD COLUMN translation TEXT;
ALTER TABLE emails ADD COLUMN translation_lang TEXT;

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
