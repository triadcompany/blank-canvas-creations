
ALTER TABLE public.ai_agent_profiles
  ADD COLUMN IF NOT EXISTS autonomous_rules jsonb DEFAULT '{"mode":"all","only_outside_business_hours":false,"pause_after_qualification":false}'::jsonb;
