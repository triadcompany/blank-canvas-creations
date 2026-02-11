-- =============================================
-- PASSO 4: IA Autônoma (Safe Auto) - Schema
-- =============================================

-- 1) Add ai_generated and ai_interaction_id to messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_interaction_id UUID REFERENCES public.ai_interactions(id);

-- 2) Add throttle fields to conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_ai_reply_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_reply_count_since_last_lead INT NOT NULL DEFAULT 0;

-- 3) Add sensitive flag to pipeline_stages
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS sensitive BOOLEAN NOT NULL DEFAULT false;

-- Mark known sensitive stages
UPDATE public.pipeline_stages
SET sensitive = true
WHERE LOWER(name) IN ('venda', 'perdido', 'visita realizada');

-- 4) Create auto-reply jobs table for dedup/queue
CREATE TABLE IF NOT EXISTS public.ai_auto_reply_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id),
  inbound_message_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, blocked, throttled, failed
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT uq_ai_auto_reply_idempotency UNIQUE (idempotency_key)
);

ALTER TABLE public.ai_auto_reply_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view ai_auto_reply_jobs"
  ON public.ai_auto_reply_jobs FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Index for worker polling
CREATE INDEX IF NOT EXISTS idx_ai_auto_reply_jobs_pending
  ON public.ai_auto_reply_jobs(status, created_at)
  WHERE status = 'pending';

-- 5) Add org-level AI system prompt
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ai_system_prompt TEXT,
  ADD COLUMN IF NOT EXISTS ai_auto_reply_throttle_seconds INT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS ai_auto_max_without_reply INT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS ai_auto_debounce_seconds INT NOT NULL DEFAULT 4;