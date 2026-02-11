
ALTER TABLE public.meta_capi_events
  ADD COLUMN IF NOT EXISTS pipeline_id UUID,
  ADD COLUMN IF NOT EXISTS stage_id UUID,
  ADD COLUMN IF NOT EXISTS mapping_id UUID,
  ADD COLUMN IF NOT EXISTS dedupe_skipped BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'automation';
