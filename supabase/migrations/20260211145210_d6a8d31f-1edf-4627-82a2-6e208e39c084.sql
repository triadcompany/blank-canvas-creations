
-- Create automation_keyword_rules table
CREATE TABLE public.automation_keyword_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  keyword TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains', 'equals', 'starts_with')),
  create_lead BOOLEAN NOT NULL DEFAULT true,
  lead_source TEXT NOT NULL DEFAULT 'Meta Ads',
  pipeline_id UUID NULL,
  stage_id UUID NULL,
  tags JSONB NULL DEFAULT '[]'::jsonb,
  priority INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.automation_keyword_rules ENABLE ROW LEVEL SECURITY;

-- RLS: users can read rules for their org
CREATE POLICY "Users can view keyword rules for their org"
  ON public.automation_keyword_rules
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );

-- RLS: admins can insert
CREATE POLICY "Admins can create keyword rules"
  ON public.automation_keyword_rules
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
    )
    AND public.has_role(auth.uid(), 'admin')
  );

-- RLS: admins can update
CREATE POLICY "Admins can update keyword rules"
  ON public.automation_keyword_rules
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
    )
    AND public.has_role(auth.uid(), 'admin')
  );

-- RLS: admins can delete
CREATE POLICY "Admins can delete keyword rules"
  ON public.automation_keyword_rules
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
    )
    AND public.has_role(auth.uid(), 'admin')
  );

-- Index for webhook lookups
CREATE INDEX idx_keyword_rules_org_active ON public.automation_keyword_rules(organization_id, is_active) WHERE is_active = true;

-- Update trigger
CREATE TRIGGER update_keyword_rules_updated_at
  BEFORE UPDATE ON public.automation_keyword_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
