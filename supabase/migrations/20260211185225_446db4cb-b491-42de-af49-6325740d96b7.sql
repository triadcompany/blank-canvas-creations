
-- ============================================================
-- Meta CAPI Events table for tracking conversion events
-- ============================================================

CREATE TABLE IF NOT EXISTS public.meta_capi_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  phone TEXT,
  event_name TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_id TEXT NOT NULL,
  payload_json JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  response_json JSONB,
  fail_reason TEXT,
  attempts INT NOT NULL DEFAULT 0,
  trace_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_meta_capi_events_org_created ON public.meta_capi_events(organization_id, created_at DESC);
CREATE UNIQUE INDEX idx_meta_capi_events_dedupe ON public.meta_capi_events(organization_id, event_id);

-- Enable RLS with permissive policy (Clerk-based auth)
ALTER TABLE public.meta_capi_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to meta_capi_events"
  ON public.meta_capi_events
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at
CREATE TRIGGER update_meta_capi_events_updated_at
  BEFORE UPDATE ON public.meta_capi_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Add meta_test_event_code to meta_integrations if not exists
-- ============================================================
ALTER TABLE public.meta_integrations
  ADD COLUMN IF NOT EXISTS meta_test_event_code TEXT;
