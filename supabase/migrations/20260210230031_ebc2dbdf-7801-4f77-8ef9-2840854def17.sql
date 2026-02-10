
-- Add ai_mode column to conversations
ALTER TABLE public.conversations
  ADD COLUMN ai_mode text NOT NULL DEFAULT 'off'
  CONSTRAINT conversations_ai_mode_check CHECK (ai_mode IN ('off', 'assisted'));
