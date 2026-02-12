
-- 1) Add status, lock, and status change tracking to conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_status_change_at timestamptz DEFAULT now();

-- 2) Create conversation_events table for audit log
CREATE TABLE IF NOT EXISTS public.conversation_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  event_type text NOT NULL, -- auto_assigned, assumed, released, closed, reopened, locked, unlocked
  performed_by uuid REFERENCES public.profiles(id),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_conversation_events_conversation ON public.conversation_events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_org ON public.conversation_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_locked_by ON public.conversations(locked_by);

-- RLS for conversation_events (permissive, matching project pattern with Clerk auth)
ALTER TABLE public.conversation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversation_events_select" ON public.conversation_events FOR SELECT USING (true);
CREATE POLICY "conversation_events_insert" ON public.conversation_events FOR INSERT WITH CHECK (true);
CREATE POLICY "conversation_events_update" ON public.conversation_events FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "conversation_events_delete" ON public.conversation_events FOR DELETE USING (true);
