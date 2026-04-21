-- Fix RLS policy on clerk_organizations: it was using auth.jwt() ->> 'sub' which
-- returns NULL for Clerk-authenticated sessions. Use get_clerk_user_id() helper
-- so the org-switcher in the sidebar can resolve organization names.

DROP POLICY IF EXISTS "Users can view their organizations" ON public.clerk_organizations;

CREATE POLICY "Users can view their organizations"
ON public.clerk_organizations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.organization_id = clerk_organizations.id
      AND om.clerk_user_id = public.get_clerk_user_id()
      AND om.status = 'active'
  )
);