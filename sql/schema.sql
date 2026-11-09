CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    subject TEXT,
    received_at INTEGER NOT NULL,
    html_content TEXT,
    text_content TEXT,
    has_attachments BOOLEAN DEFAULT FALSE,
    attachment_count INTEGER DEFAULT 0,
    direction TEXT NOT NULL DEFAULT 'inbound',
    message_id TEXT,
    in_reply_to TEXT,
    references_header TEXT,
    read BOOLEAN DEFAULT FALSE,
    starred BOOLEAN DEFAULT FALSE,
    archived BOOLEAN DEFAULT FALSE,
    deleted_at INTEGER,
    updated_at INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    summary_lang TEXT,
    translation TEXT,
    translation_lang TEXT
);

-- Single-tenant key/value preferences (one API token = one user).
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    email_id TEXT NOT NULL,
    filename TEXT,
    mime_type TEXT,
    size INTEGER NOT NULL,
    r2_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
    token TEXT PRIMARY KEY,
    platform TEXT NOT NULL DEFAULT 'ios',
    environment TEXT NOT NULL DEFAULT 'production',
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);
