
-- Table to log every Evolution webhook event for debugging
CREATE TABLE public.evolution_webhook_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_name TEXT,
  event_type TEXT,
  remote_jid TEXT,
  detected_organization_id UUID,
  payload JSONB,
  processing_result TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying by org
CREATE INDEX idx_ewl_org_id ON public.evolution_webhook_logs(detected_organization_id);
CREATE INDEX idx_ewl_created_at ON public.evolution_webhook_logs(created_at DESC);

-- RLS
ALTER TABLE public.evolution_webhook_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role key)
CREATE POLICY "Service role full access" ON public.evolution_webhook_logs
  FOR ALL USING (true) WITH CHECK (true);

-- Auto-cleanup: keep only last 7 days
CREATE OR REPLACE FUNCTION public.cleanup_old_webhook_logs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.evolution_webhook_logs WHERE created_at < now() - interval '7 days';
$$;
