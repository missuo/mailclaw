-- One-time upgrade for deployments created before the app-protocol release.
-- Fresh installs get all of this from schema.sql; do not run this twice
-- (SQLite has no ADD COLUMN IF NOT EXISTS, so a re-run fails on the first ALTER).
ALTER TABLE emails ADD COLUMN direction TEXT NOT NULL DEFAULT 'inbound';
ALTER TABLE emails ADD COLUMN message_id TEXT;
ALTER TABLE emails ADD COLUMN in_reply_to TEXT;
ALTER TABLE emails ADD COLUMN references_header TEXT;
ALTER TABLE emails ADD COLUMN read BOOLEAN DEFAULT FALSE;
ALTER TABLE emails ADD COLUMN starred BOOLEAN DEFAULT FALSE;
ALTER TABLE emails ADD COLUMN archived BOOLEAN DEFAULT FALSE;
ALTER TABLE emails ADD COLUMN deleted_at INTEGER;
ALTER TABLE emails ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE emails SET updated_at = received_at WHERE updated_at = 0;

CREATE TABLE IF NOT EXISTS devices (
    token TEXT PRIMARY KEY,
    platform TEXT NOT NULL DEFAULT 'ios',
    environment TEXT NOT NULL DEFAULT 'production',
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);
