
-- =============================================
-- META CAPI SETTINGS (1 per org)
-- =============================================
CREATE TABLE IF NOT EXISTS public.meta_capi_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL UNIQUE REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
  pixel_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  test_event_code TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_capi_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org meta_capi_settings"
  ON public.meta_capi_settings FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can insert own org meta_capi_settings"
  ON public.meta_capi_settings FOR INSERT
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can update own org meta_capi_settings"
  ON public.meta_capi_settings FOR UPDATE
  USING (organization_id = public.get_user_organization_id());

-- =============================================
-- META CAPI MAPPINGS (pipeline+stage -> event)
-- =============================================
CREATE TABLE IF NOT EXISTS public.meta_capi_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
  pipeline_id UUID,
  stage_id UUID NOT NULL,
  meta_event TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_capi_mappings_org ON public.meta_capi_mappings(organization_id);
CREATE INDEX IF NOT EXISTS idx_meta_capi_mappings_stage ON public.meta_capi_mappings(stage_id);

ALTER TABLE public.meta_capi_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org meta_capi_mappings"
  ON public.meta_capi_mappings FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can insert own org meta_capi_mappings"
  ON public.meta_capi_mappings FOR INSERT
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can update own org meta_capi_mappings"
  ON public.meta_capi_mappings FOR UPDATE
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can delete own org meta_capi_mappings"
  ON public.meta_capi_mappings FOR DELETE
  USING (organization_id = public.get_user_organization_id());

-- =============================================
-- META CAPI LOGS
-- =============================================
CREATE TABLE IF NOT EXISTS public.meta_capi_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
  lead_id UUID,
  pipeline_id UUID,
  stage_id UUID,
  meta_event TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  http_status INT,
  request_json JSONB,
  response_json JSONB,
  fail_reason TEXT,
  trace_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_capi_logs_org ON public.meta_capi_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_meta_capi_logs_created ON public.meta_capi_logs(created_at DESC);

ALTER TABLE public.meta_capi_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org meta_capi_logs"
  ON public.meta_capi_logs FOR SELECT
  USING (organization_id = public.get_user_organization_id());

-- Service role can insert logs (from edge functions)
CREATE POLICY "Service can insert meta_capi_logs"
  ON public.meta_capi_logs FOR INSERT
  WITH CHECK (true);
