
-- Automations table (stores the flow definition)
CREATE TABLE public.automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  is_active BOOLEAN NOT NULL DEFAULT false,
  flow_definition JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  created_by UUID NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view automations in their org"
ON public.automations FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_organization_id()
);

CREATE POLICY "Admins can insert automations"
ON public.automations FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = public.get_user_organization_id()
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admins can update automations"
ON public.automations FOR UPDATE
TO authenticated
USING (
  organization_id = public.get_user_organization_id()
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admins can delete automations"
ON public.automations FOR DELETE
TO authenticated
USING (
  organization_id = public.get_user_organization_id()
  AND public.has_role(auth.uid(), 'admin')
);

-- Automation execution logs
CREATE TABLE public.automation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  node_id TEXT,
  node_type TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view automation logs in their org"
ON public.automation_logs FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_organization_id()
);

CREATE POLICY "System can insert automation logs"
ON public.automation_logs FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = public.get_user_organization_id()
);

-- Indexes
CREATE INDEX idx_automations_org ON public.automations(organization_id);
CREATE INDEX idx_automation_logs_automation ON public.automation_logs(automation_id);
CREATE INDEX idx_automation_logs_created ON public.automation_logs(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER update_automations_updated_at
  BEFORE UPDATE ON public.automations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
