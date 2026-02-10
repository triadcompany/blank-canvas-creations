
-- ════════════════════════════════════════════════════════
-- EVENT BUS: automation_events (central event table)
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.automation_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  event_name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'conversation',
  entity_id UUID,
  conversation_id UUID,
  lead_id UUID,
  opportunity_id UUID,
  payload JSONB DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'system',
  source_ai_interaction_id UUID,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  CONSTRAINT automation_events_source_check CHECK (source IN ('ai', 'human', 'system')),
  CONSTRAINT automation_events_status_check CHECK (status IN ('pending', 'processed', 'failed', 'skipped'))
);

-- Unique constraint for idempotency per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_events_idempotency 
  ON public.automation_events (organization_id, idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_automation_events_pending 
  ON public.automation_events (organization_id, status, created_at) 
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_automation_events_org_created 
  ON public.automation_events (organization_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view events in their org" ON public.automation_events
  FOR SELECT USING (true);

CREATE POLICY "Users can insert events in their org" ON public.automation_events
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service can update events" ON public.automation_events
  FOR UPDATE USING (true);

-- ════════════════════════════════════════════════════════
-- AUDIT: automation_event_runs (per-automation execution log)
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.automation_event_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_event_id UUID NOT NULL REFERENCES public.automation_events(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  output JSONB,
  error TEXT,
  skipped_reason TEXT,
  CONSTRAINT aer_status_check CHECK (status IN ('pending', 'success', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_aer_event ON public.automation_event_runs (automation_event_id);
CREATE INDEX IF NOT EXISTS idx_aer_automation ON public.automation_event_runs (automation_id);
CREATE INDEX IF NOT EXISTS idx_aer_org ON public.automation_event_runs (organization_id, started_at DESC);

ALTER TABLE public.automation_event_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view event runs in their org" ON public.automation_event_runs
  FOR SELECT USING (true);

CREATE POLICY "Service can insert event runs" ON public.automation_event_runs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service can update event runs" ON public.automation_event_runs
  FOR UPDATE USING (true);

-- ════════════════════════════════════════════════════════
-- AUTOMATIONS: Add event trigger config columns
-- ════════════════════════════════════════════════════════
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS trigger_type TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS trigger_event_name TEXT,
  ADD COLUMN IF NOT EXISTS allow_ai_triggers BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_human_triggers BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS throttle_seconds INTEGER DEFAULT 0;

-- ════════════════════════════════════════════════════════
-- CONVERSATIONS: Add ai_state for human/ai lock
-- ════════════════════════════════════════════════════════
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_state TEXT DEFAULT 'ai_active';

-- Cleanup function for old events (keep 30 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_automation_events()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  DELETE FROM public.automation_events WHERE created_at < now() - interval '30 days';
  DELETE FROM public.automation_event_runs WHERE started_at < now() - interval '30 days';
$$;
