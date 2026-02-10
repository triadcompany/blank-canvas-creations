
-- Add contact_name and last_message_preview to conversations for better UI
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_preview text;
