CREATE INDEX IF NOT EXISTS idx_emails_to_received ON emails (to_address, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_from_received ON emails (from_address, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_received ON emails (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_updated ON emails (updated_at);
CREATE INDEX IF NOT EXISTS idx_emails_direction ON emails (direction, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_deleted ON emails (deleted_at);
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails (message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments (email_id);
