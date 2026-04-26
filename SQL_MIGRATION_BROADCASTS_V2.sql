-- ============================================================
-- BROADCASTS V2 — Source types, filters, scheduling
-- ============================================================
-- Run in the Supabase SQL editor.
-- ============================================================

-- ── 1. Add source columns to broadcast_campaigns ──
ALTER TABLE public.broadcast_campaigns
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'spreadsheet'
    CHECK (source_type IN ('spreadsheet', 'crm_leads', 'inbox')),
  ADD COLUMN IF NOT EXISTS source_filters jsonb,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

-- Allow 'scheduled' as a valid status
-- (existing CHECK constraint on status may need updating)
-- If there's a CHECK constraint, drop and recreate:
ALTER TABLE public.broadcast_campaigns
  DROP CONSTRAINT IF EXISTS broadcast_campaigns_status_check;

ALTER TABLE public.broadcast_campaigns
  ADD CONSTRAINT broadcast_campaigns_status_check
    CHECK (status IN ('running', 'paused', 'completed', 'canceled', 'scheduled'));

-- ── 2. Index for scheduled campaigns ──
CREATE INDEX IF NOT EXISTS broadcast_campaigns_scheduled_idx
  ON public.broadcast_campaigns (scheduled_at)
  WHERE status = 'scheduled' AND scheduled_at IS NOT NULL;

-- ── 3. Index for source_type ──
CREATE INDEX IF NOT EXISTS broadcast_campaigns_source_type_idx
  ON public.broadcast_campaigns (organization_id, source_type);
