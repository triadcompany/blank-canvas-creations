-- Fix RLS on org_members: the existing SELECT policy used auth.jwt()->>'sub'
-- which is NULL for Clerk sessions, so the org switcher dropdown could not
-- list the organizations the user belongs to.
DROP POLICY IF EXISTS "Users can view members of their organizations" ON public.org_members;

-- Allow each user to see their own memberships (needed for the org switcher).
CREATE POLICY "Users can view their own org memberships"
ON public.org_members
FOR SELECT
USING (clerk_user_id = public.get_clerk_user_id());

-- Allow each user to see other members of organizations they belong to
-- (needed for the "Members" management screens).
CREATE POLICY "Users can view members of their organizations"
ON public.org_members
FOR SELECT
USING (
  organization_id IN (
    SELECT om.organization_id
    FROM public.org_members om
    WHERE om.clerk_user_id = public.get_clerk_user_id()
      AND om.status = 'active'
  )
);