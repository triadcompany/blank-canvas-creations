
CREATE OR REPLACE FUNCTION public.get_org_profile_members(p_org_id uuid)
RETURNS TABLE(
  profile_id uuid,
  name text,
  email text,
  avatar_url text,
  clerk_user_id text,
  role text,
  is_owner boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.id AS profile_id,
    COALESCE(NULLIF(p.name, ''), up.full_name, split_part(COALESCE(p.email, up.email), '@', 1)) AS name,
    COALESCE(p.email, up.email) AS email,
    COALESCE(p.avatar_url, up.avatar_url) AS avatar_url,
    om.clerk_user_id,
    COALESCE(ur.role::text, om.role::text, 'seller') AS role,
    (o.owner_profile_id = p.id) AS is_owner
  FROM org_members om
  JOIN profiles p
    ON p.clerk_user_id = om.clerk_user_id
  LEFT JOIN users_profile up
    ON up.clerk_user_id = om.clerk_user_id
  LEFT JOIN user_roles ur
    ON ur.clerk_user_id = om.clerk_user_id
   AND ur.organization_id = p_org_id
  LEFT JOIN organizations o
    ON o.id = p_org_id
  WHERE om.organization_id = p_org_id
    AND om.status = 'active'
  ORDER BY (o.owner_profile_id = p.id) DESC, COALESCE(p.name, up.full_name, '') ASC;
$function$;
