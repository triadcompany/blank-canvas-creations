
-- Table for custom CAPI event definitions per organization
CREATE TABLE public.capi_event_definitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  meta_event_name TEXT NOT NULL,
  default_currency TEXT NOT NULL DEFAULT 'BRL',
  send_value BOOLEAN NOT NULL DEFAULT true,
  send_user_data BOOLEAN NOT NULL DEFAULT true,
  send_location BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint: no duplicate meta_event_name per org
ALTER TABLE public.capi_event_definitions
  ADD CONSTRAINT uq_capi_event_def_org_meta_name UNIQUE (organization_id, meta_event_name);

-- RLS
ALTER TABLE public.capi_event_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org event definitions"
  ON public.capi_event_definitions FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own org event definitions"
  ON public.capi_event_definitions FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update own org event definitions"
  ON public.capi_event_definitions FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own org event definitions"
  ON public.capi_event_definitions FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Index for fast lookups
CREATE INDEX idx_capi_event_def_org ON public.capi_event_definitions(organization_id);
