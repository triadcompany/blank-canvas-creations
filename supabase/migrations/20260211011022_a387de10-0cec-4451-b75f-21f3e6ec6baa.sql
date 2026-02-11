-- Add ai_pending state columns to conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_pending_started_at timestamptz DEFAULT NULL;
