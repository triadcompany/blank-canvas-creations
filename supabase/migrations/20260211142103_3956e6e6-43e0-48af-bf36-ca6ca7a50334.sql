
-- 1) Organization automation settings
CREATE TABLE IF NOT EXISTS public.organization_automation_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  meta_ads_keyword_enabled BOOLEAN NOT NULL DEFAULT true,
  meta_ads_pipeline_id UUID REFERENCES public.pipelines(id) ON DELETE SET NULL,
  meta_ads_stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_automation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org settings" ON public.organization_automation_settings
  FOR SELECT USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Admins can manage own org settings" ON public.organization_automation_settings
  FOR ALL USING (organization_id IN (
    SELECT p.organization_id FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE p.user_id = auth.uid() AND ur.role = 'admin'
  ));

-- 2) WhatsApp first touch dedup table
CREATE TABLE IF NOT EXISTS public.whatsapp_first_touch (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  first_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, phone)
);

ALTER TABLE public.whatsapp_first_touch ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only for first_touch" ON public.whatsapp_first_touch
  FOR ALL USING (false);
