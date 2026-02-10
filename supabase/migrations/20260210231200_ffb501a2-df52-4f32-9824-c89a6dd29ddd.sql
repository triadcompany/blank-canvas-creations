
-- Table to log AI stage suggestions and human applications
CREATE TABLE public.ai_stage_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  lead_id UUID,
  from_stage_id UUID,
  from_stage_name TEXT,
  to_stage_id UUID,
  to_stage_name TEXT,
  suggested_pipeline_id UUID,
  suggested_reason TEXT,
  suggested_action_type TEXT,
  ai_interaction_id UUID REFERENCES public.ai_interactions(id),
  applied_by UUID REFERENCES public.profiles(id),
  applied_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'applied', 'ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_stage_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view ai_stage_actions for their org"
  ON public.ai_stage_actions FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert ai_stage_actions for their org"
  ON public.ai_stage_actions FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can update ai_stage_actions for their org"
  ON public.ai_stage_actions FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
  ));

CREATE INDEX idx_ai_stage_actions_org ON public.ai_stage_actions(organization_id);
CREATE INDEX idx_ai_stage_actions_conversation ON public.ai_stage_actions(conversation_id);
