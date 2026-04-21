CREATE OR REPLACE FUNCTION public.get_org_profile_members(p_org_id uuid)
RETURNS TABLE (
  profile_id uuid,
  name text,
  email text,
  avatar_url text,
  clerk_user_id text,
  role text,
  is_owner boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.id AS profile_id,
    p.name,
    p.email,
    p.avatar_url,
    p.clerk_user_id,
    COALESCE(ur.role::text, 'seller') AS role,
    (o.owner_profile_id = p.id) AS is_owner
  FROM profiles p
  LEFT JOIN user_roles ur
    ON ur.clerk_user_id = p.clerk_user_id
   AND ur.organization_id = p_org_id
  LEFT JOIN organizations o ON o.id = p_org_id
  WHERE p.organization_id = p_org_id
  ORDER BY (o.owner_profile_id = p.id) DESC, p.name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_profile_members(uuid) TO anon, authenticated;