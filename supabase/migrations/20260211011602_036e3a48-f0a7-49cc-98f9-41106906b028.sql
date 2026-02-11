-- Fix: inbound_message_id must be TEXT, not UUID, because Evolution API message IDs are not UUIDs
ALTER TABLE public.ai_auto_reply_jobs
  ALTER COLUMN inbound_message_id TYPE text;