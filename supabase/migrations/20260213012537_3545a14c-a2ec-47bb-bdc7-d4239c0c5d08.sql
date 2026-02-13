
-- ============================================
-- FASE 1: Mirror tables for Clerk sync
-- ============================================

-- A) organizations (mirror of Clerk orgs)
CREATE TABLE IF NOT EXISTS public.clerk_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id text UNIQUE NOT NULL,
  name text NOT NULL,
  slug text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- B) org_members
CREATE TABLE IF NOT EXISTS public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.clerk_organizations(id) ON DELETE CASCADE,
  clerk_org_id text NOT NULL,
  clerk_user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'seller')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, clerk_user_id),
  UNIQUE (clerk_org_id, clerk_user_id)
);

-- C) users_profile (Clerk user mirror)
CREATE TABLE IF NOT EXISTS public.users_profile (
  clerk_user_id text PRIMARY KEY,
  email text,
  full_name text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- D) Trigger function for updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_clerk_organizations_updated_at
  BEFORE UPDATE ON public.clerk_organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_org_members_updated_at
  BEFORE UPDATE ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_users_profile_updated_at
  BEFORE UPDATE ON public.users_profile
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================
-- RLS Policies
-- ============================================

-- Enable RLS
ALTER TABLE public.clerk_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users_profile ENABLE ROW LEVEL SECURITY;

-- clerk_organizations: SELECT only if user is member
CREATE POLICY "Users can view their organizations"
  ON public.clerk_organizations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_members.organization_id = clerk_organizations.id
        AND org_members.clerk_user_id = (auth.jwt()->>'sub')
    )
  );

-- org_members: SELECT only members of same org
CREATE POLICY "Users can view members of their organizations"
  ON public.org_members FOR SELECT TO authenticated
  USING (
    clerk_org_id IN (
      SELECT om.clerk_org_id FROM public.org_members om
      WHERE om.clerk_user_id = (auth.jwt()->>'sub')
    )
  );

-- users_profile: SELECT own + same org members
CREATE POLICY "Users can view own profile and org members profiles"
  ON public.users_profile FOR SELECT TO authenticated
  USING (
    clerk_user_id = (auth.jwt()->>'sub')
    OR clerk_user_id IN (
      SELECT om2.clerk_user_id FROM public.org_members om2
      WHERE om2.clerk_org_id IN (
        SELECT om1.clerk_org_id FROM public.org_members om1
        WHERE om1.clerk_user_id = (auth.jwt()->>'sub')
      )
    )
  );

-- No INSERT/UPDATE/DELETE policies for authenticated users
-- Only service_role (edge functions) can write

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_org_members_clerk_user_id ON public.org_members(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_clerk_org_id ON public.org_members(clerk_org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON public.org_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_clerk_organizations_clerk_org_id ON public.clerk_organizations(clerk_org_id);
