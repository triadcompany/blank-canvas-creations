
-- Event Dispatch Queue: reliable delivery layer for Meta CAPI (and future channels)
CREATE TABLE public.event_dispatch_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  lead_id UUID,
  event_name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'meta_capi',
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','success','error')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 6,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  event_hash TEXT NOT NULL,
  automation_id UUID,
  run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Performance indexes
CREATE INDEX idx_edq_status_retry ON public.event_dispatch_queue (status, next_retry_at) WHERE status IN ('pending','processing');
CREATE UNIQUE INDEX idx_edq_event_hash_unique ON public.event_dispatch_queue (event_hash) WHERE status IN ('pending','processing','success');
CREATE INDEX idx_edq_org_created ON public.event_dispatch_queue (organization_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.event_dispatch_queue ENABLE ROW LEVEL SECURITY;

-- RLS policies (service role bypasses, users see their org's data)
CREATE POLICY "Users can view their org queue"
  ON public.event_dispatch_queue FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Service role handles inserts/updates (from edge functions)
CREATE POLICY "Service role full access"
  ON public.event_dispatch_queue FOR ALL
  USING (true)
  WITH CHECK (true);
