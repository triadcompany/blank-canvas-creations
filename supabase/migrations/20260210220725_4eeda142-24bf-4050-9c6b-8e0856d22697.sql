-- Add profile_picture_url to conversations for WhatsApp avatar
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS profile_picture_url text;

-- Add assigned_at timestamp for assignment tracking
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_at timestamp with time zone;