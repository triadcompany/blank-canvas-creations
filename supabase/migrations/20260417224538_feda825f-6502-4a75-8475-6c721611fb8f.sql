CREATE OR REPLACE FUNCTION public.get_org_profiles_with_roles(p_org_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'profiles', COALESCE((
      SELECT json_agg(
        json_build_object(
          'id', p.id,
          'user_id', up.clerk_user_id,
          'clerk_user_id', up.clerk_user_id,
          'name', up.full_name,
          'email', up.email,
          'avatar_url', up.avatar_url,
          'organization_id', om.organization_id,
          'created_at', up.created_at,
          'updated_at', up.updated_at
        )
      )
      FROM users_profile up
      INNER JOIN org_members om ON om.clerk_user_id = up.clerk_user_id
      LEFT JOIN profiles p ON p.clerk_user_id = up.clerk_user_id
      WHERE om.organization_id = p_org_id AND om.status = 'active'
    ), '[]'::json),
    'roles', COALESCE((
      SELECT json_agg(json_build_object('clerk_user_id', om.clerk_user_id, 'role', om.role))
      FROM org_members om
      WHERE om.organization_id = p_org_id AND om.status = 'active'
    ), '[]'::json),
    'invitations', COALESCE((
      SELECT json_agg(row_to_json(i.*) ORDER BY i.created_at DESC)
      FROM user_invitations i
      WHERE i.organization_id = p_org_id
        AND i.status IN ('pending', 'revoked')
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$function$;