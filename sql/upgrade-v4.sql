-- One-time upgrade for deployments on 2.1.x, adding AI-extracted one-time
-- codes (2.2.0). Fresh installs get this from schema.sql; do not run twice
-- (SQLite has no ADD COLUMN IF NOT EXISTS, so a re-run fails on the ALTER).
ALTER TABLE emails ADD COLUMN otp TEXT;
