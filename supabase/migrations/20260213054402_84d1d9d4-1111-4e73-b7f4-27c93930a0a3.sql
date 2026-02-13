
CREATE OR REPLACE FUNCTION public.get_org_members(p_org_id uuid)
RETURNS TABLE(user_id uuid, full_name text, clerk_user_id text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.id as user_id, up.full_name, om.clerk_user_id, om.role
  FROM org_members om
  JOIN users_profile up ON up.clerk_user_id = om.clerk_user_id
  WHERE om.organization_id = p_org_id
  ORDER BY up.full_name;
$$;
