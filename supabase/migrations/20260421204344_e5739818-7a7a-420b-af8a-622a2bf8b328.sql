-- Drop the recursive policy
DROP POLICY IF EXISTS "Users can view members of their organizations" ON public.org_members;

-- Create a SECURITY DEFINER function that bypasses RLS to get the current user's
-- organizations. This avoids infinite recursion when used inside a policy on org_members.
CREATE OR REPLACE FUNCTION public.get_user_active_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT om.organization_id
  FROM public.org_members om
  WHERE om.clerk_user_id = public.get_clerk_user_id()
    AND om.status = 'active';
$$;

-- Re-create the "view team members" policy using the security-definer function
CREATE POLICY "Users can view members of their organizations"
ON public.org_members
FOR SELECT
USING (organization_id IN (SELECT public.get_user_active_org_ids()));