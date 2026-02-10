
-- Runs de automação
CREATE TABLE public.automation_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_id UUID NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','waiting','completed','failed','cancelled')),
  current_node_id TEXT,
  next_run_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view runs" ON public.automation_runs
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage runs" ON public.automation_runs
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_automation_runs_waiting ON public.automation_runs (status, next_run_at)
  WHERE status = 'waiting';
CREATE INDEX idx_automation_runs_automation ON public.automation_runs (automation_id);
CREATE INDEX idx_automation_runs_lead ON public.automation_runs (lead_id);

-- Steps de cada run
CREATE TABLE public.automation_run_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','skipped')),
  input_data JSONB,
  output_data JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_run_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view steps" ON public.automation_run_steps
  FOR SELECT USING (
    run_id IN (
      SELECT id FROM public.automation_runs WHERE organization_id IN (
        SELECT organization_id FROM public.profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Service role can manage steps" ON public.automation_run_steps
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_automation_run_steps_run ON public.automation_run_steps (run_id);

-- Trigger para updated_at
CREATE TRIGGER update_automation_runs_updated_at
  BEFORE UPDATE ON public.automation_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
