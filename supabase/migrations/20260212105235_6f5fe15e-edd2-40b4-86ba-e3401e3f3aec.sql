
-- Deduplication table for Meta CAPI events
CREATE TABLE IF NOT EXISTS public.meta_capi_dedup (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.saas_organizations(id),
  event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, event_id)
);

ALTER TABLE public.meta_capi_dedup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for meta_capi_dedup"
  ON public.meta_capi_dedup FOR ALL USING (true);

CREATE INDEX idx_meta_capi_dedup_org_event ON public.meta_capi_dedup(organization_id, event_id);

-- Auto-cleanup old dedup records (older than 30 days)
CREATE OR REPLACE FUNCTION public.cleanup_meta_capi_dedup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.meta_capi_dedup WHERE created_at < now() - interval '30 days';
END;
$$;
