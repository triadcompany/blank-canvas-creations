
-- Phase 2: Add missing columns to Phase 1 tables

-- A) users_profile: add id (uuid), last_login_at
ALTER TABLE public.users_profile
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- Rename image_url to avatar_url for consistency
ALTER TABLE public.users_profile
  RENAME COLUMN image_url TO avatar_url;

-- B) clerk_organizations: add created_by_clerk_user_id, unique slug
ALTER TABLE public.clerk_organizations
  ADD COLUMN IF NOT EXISTS created_by_clerk_user_id text;

-- Add unique constraint on slug (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clerk_organizations_slug
  ON public.clerk_organizations(slug) WHERE slug IS NOT NULL;

-- C) org_members: add status column
ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
