-- Fix: add 'auto' to the ai_mode check constraint
ALTER TABLE public.conversations DROP CONSTRAINT conversations_ai_mode_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_ai_mode_check CHECK (ai_mode = ANY (ARRAY['off'::text, 'assisted'::text, 'auto'::text]));