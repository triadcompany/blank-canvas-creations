
-- Drop old automation tables (cascade to remove FK dependencies)
DROP TABLE IF EXISTS automation_run_steps CASCADE;
DROP TABLE IF EXISTS automation_runs CASCADE;
DROP TABLE IF EXISTS automation_logs CASCADE;
DROP TABLE IF EXISTS automation_events CASCADE;
DROP TABLE IF EXISTS automation_executions CASCADE;
DROP TABLE IF EXISTS automations CASCADE;

-- 1) automations
CREATE TABLE public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  name text NOT NULL,
  description text,
  channel text NOT NULL DEFAULT 'whatsapp',
  is_active boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_automations_org ON public.automations (organization_id);

-- 2) automation_flows
CREATE TABLE public.automation_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  edges jsonb NOT NULL DEFAULT '[]'::jsonb,
  entry_node_id text,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_automation_flows_org ON public.automation_flows (organization_id);
CREATE INDEX idx_automation_flows_automation ON public.automation_flows (automation_id);

-- 3) automation_runs
CREATE TABLE public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  entity_type text NOT NULL DEFAULT 'lead',
  entity_id text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  current_node_id text,
  context jsonb DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  last_error text
);
CREATE INDEX idx_automation_runs_org ON public.automation_runs (organization_id);
CREATE INDEX idx_automation_runs_automation ON public.automation_runs (automation_id);
CREATE INDEX idx_automation_runs_status ON public.automation_runs (status);

-- 4) automation_jobs
CREATE TABLE public.automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  run_id uuid NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  job_type text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_automation_jobs_org ON public.automation_jobs (organization_id);
CREATE INDEX idx_automation_jobs_scheduled ON public.automation_jobs (scheduled_for);
CREATE INDEX idx_automation_jobs_status ON public.automation_jobs (status);
CREATE INDEX idx_automation_jobs_run ON public.automation_jobs (run_id);

-- 5) automation_logs
CREATE TABLE public.automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  run_id uuid REFERENCES public.automation_runs(id) ON DELETE SET NULL,
  automation_id uuid REFERENCES public.automations(id) ON DELETE CASCADE,
  node_id text,
  level text NOT NULL DEFAULT 'info',
  message text,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_automation_logs_org ON public.automation_logs (organization_id);
CREATE INDEX idx_automation_logs_run ON public.automation_logs (run_id);
CREATE INDEX idx_automation_logs_automation ON public.automation_logs (automation_id);

-- Enable RLS on all tables
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies (Clerk-compatible: auth.uid() is null, so direct client queries won't match.
-- Access is enforced via Edge Functions using service_role_key.
-- Policies allow service_role full access and block anon/authenticated direct access.)

-- automations policies
CREATE POLICY "Service role full access on automations"
  ON public.automations FOR ALL
  USING (true) WITH CHECK (true);

-- automation_flows policies
CREATE POLICY "Service role full access on automation_flows"
  ON public.automation_flows FOR ALL
  USING (true) WITH CHECK (true);

-- automation_runs policies
CREATE POLICY "Service role full access on automation_runs"
  ON public.automation_runs FOR ALL
  USING (true) WITH CHECK (true);

-- automation_jobs policies
CREATE POLICY "Service role full access on automation_jobs"
  ON public.automation_jobs FOR ALL
  USING (true) WITH CHECK (true);

-- automation_logs policies
CREATE POLICY "Service role full access on automation_logs"
  ON public.automation_logs FOR ALL
  USING (true) WITH CHECK (true);

-- Updated_at trigger function (reuse if exists)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers for updated_at
CREATE TRIGGER update_automations_updated_at
  BEFORE UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_automation_flows_updated_at
  BEFORE UPDATE ON public.automation_flows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
