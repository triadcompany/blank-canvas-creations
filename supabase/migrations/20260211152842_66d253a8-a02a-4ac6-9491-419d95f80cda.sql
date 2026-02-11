-- Table to persist end-to-end diagnostics for inbound events → automation matching
CREATE TABLE IF NOT EXISTS public.automation_executions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  trace_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  automation_event_id UUID NULL,
  automation_id UUID NULL,
  phone TEXT NULL,
  channel TEXT NULL,
  message_text TEXT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  fail_reason TEXT NULL,
  debug_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful indexes for filtering in UI
CREATE INDEX IF NOT EXISTS idx_automation_executions_org_created_at
  ON public.automation_executions (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_executions_org_trace
  ON public.automation_executions (organization_id, trace_id);

CREATE INDEX IF NOT EXISTS idx_automation_executions_org_automation
  ON public.automation_executions (organization_id, automation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_executions_org_phone
  ON public.automation_executions (organization_id, phone, created_at DESC);

COMMENT ON TABLE public.automation_executions IS 'Diagnostics: trace inbound-first-message events through automation filtering and execution (trace_id, fail_reason, debug_json).';
