
-- Add pipeline_id and stage_id columns to event_dispatch_queue
ALTER TABLE public.event_dispatch_queue
  ADD COLUMN IF NOT EXISTS pipeline_id UUID NULL,
  ADD COLUMN IF NOT EXISTS stage_id UUID NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Add index for admin queries
CREATE INDEX IF NOT EXISTS idx_edq_org_status_retry
  ON public.event_dispatch_queue (organization_id, status, next_retry_at);
