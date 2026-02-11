
-- Create opportunities table for proper Lead (contact) vs Negócio (deal) separation
CREATE TABLE IF NOT EXISTS public.opportunities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  source TEXT,
  source_detail TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  value NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_opportunities_org_id ON public.opportunities(organization_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_lead_id ON public.opportunities(lead_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_pipeline_id ON public.opportunities(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage_id ON public.opportunities(stage_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON public.opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_org_lead ON public.opportunities(organization_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_org_status ON public.opportunities(organization_id, status);

-- Enable RLS
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view opportunities in their org"
  ON public.opportunities FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can insert opportunities in their org"
  ON public.opportunities FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update opportunities in their org"
  ON public.opportunities FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete opportunities in their org"
  ON public.opportunities FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Service role bypass for automation-worker
CREATE POLICY "Service role full access to opportunities"
  ON public.opportunities FOR ALL
  USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE TRIGGER update_opportunities_updated_at
  BEFORE UPDATE ON public.opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
