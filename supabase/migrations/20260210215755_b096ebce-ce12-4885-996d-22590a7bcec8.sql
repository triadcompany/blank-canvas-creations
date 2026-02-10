
-- Add external_message_id to messages for idempotency
ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_message_id text;

-- Index for idempotency checks
CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages (conversation_id, external_message_id) WHERE external_message_id IS NOT NULL;
