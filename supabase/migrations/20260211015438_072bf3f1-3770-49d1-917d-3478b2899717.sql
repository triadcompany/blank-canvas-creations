
-- Add qualification and prioritization rules to ai_agent_profiles
ALTER TABLE public.ai_agent_profiles
  ADD COLUMN IF NOT EXISTS qualification_rules jsonb DEFAULT '{"qualified_when":{"intents":[],"urgency_level":[],"sentiment":[]}}'::jsonb,
  ADD COLUMN IF NOT EXISTS prioritization_rules jsonb DEFAULT '{"priority_when":{"intents":[],"urgency_level":[]}}'::jsonb;

-- Add is_qualified and priority_level to conversation_intelligence
ALTER TABLE public.conversation_intelligence
  ADD COLUMN IF NOT EXISTS is_qualified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority_level text NOT NULL DEFAULT 'normal';

-- Index for quick filtering of qualified conversations
CREATE INDEX IF NOT EXISTS idx_conversation_intelligence_qualified
  ON public.conversation_intelligence (organization_id, is_qualified)
  WHERE is_qualified = true;

-- Index for priority filtering
CREATE INDEX IF NOT EXISTS idx_conversation_intelligence_priority
  ON public.conversation_intelligence (organization_id, priority_level)
  WHERE priority_level = 'high';
