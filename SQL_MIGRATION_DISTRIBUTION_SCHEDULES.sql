-- ============================================================
-- Distribution Schedules — Time-based lead routing rules
-- ============================================================
-- Run this migration in the Supabase SQL editor.
-- Each row defines a time window + day-of-week set that
-- overrides the default round-robin user list for a given
-- organization and bucket.
-- ============================================================

CREATE TABLE IF NOT EXISTS distribution_schedules (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   UUID        NOT NULL,
  bucket            TEXT        NOT NULL DEFAULT 'all'
                                CHECK (bucket IN ('traffic', 'non_traffic', 'all')),
  name              TEXT        NOT NULL,
  days_of_week      INTEGER[]   NOT NULL DEFAULT '{}',
  -- 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  start_time        TIME        NOT NULL,
  end_time          TIME        NOT NULL,
  -- If start_time > end_time the window crosses midnight (e.g. 22:00 → 06:00)
  assigned_user_ids TEXT[]      NOT NULL DEFAULT '{}',
  -- user_id values from profiles (Clerk user IDs stored in profiles.user_id)
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  priority          INTEGER     NOT NULL DEFAULT 0,
  -- Lower number = higher priority (evaluated in ASC order)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS distribution_schedules_org_idx
  ON distribution_schedules (organization_id, is_active);

CREATE INDEX IF NOT EXISTS distribution_schedules_bucket_idx
  ON distribution_schedules (organization_id, bucket, is_active, priority);

-- ── Updated-at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_distribution_schedules_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_distribution_schedules_updated_at ON distribution_schedules;
CREATE TRIGGER trg_distribution_schedules_updated_at
  BEFORE UPDATE ON distribution_schedules
  FOR EACH ROW EXECUTE FUNCTION update_distribution_schedules_updated_at();

-- ── Row-Level Security ───────────────────────────────────────
ALTER TABLE distribution_schedules ENABLE ROW LEVEL SECURITY;

-- Members of the org can read
CREATE POLICY "distribution_schedules_select"
  ON distribution_schedules FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM profiles
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- Any org member can insert/update/delete (admin check done in app layer)
CREATE POLICY "distribution_schedules_write"
  ON distribution_schedules FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM profiles
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );
