
CREATE OR REPLACE FUNCTION public.get_org_profiles_with_roles(p_org_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'profiles', COALESCE((
      SELECT json_agg(row_to_json(p.*) ORDER BY p.created_at DESC)
      FROM profiles p
      WHERE p.organization_id = p_org_id
    ), '[]'::json),
    'roles', COALESCE((
      SELECT json_agg(json_build_object('clerk_user_id', r.clerk_user_id, 'role', r.role))
      FROM user_roles r
      WHERE r.organization_id = p_org_id
    ), '[]'::json),
    'invitations', COALESCE((
      SELECT json_agg(row_to_json(i.*) ORDER BY i.created_at DESC)
      FROM user_invitations i
      WHERE i.organization_id = p_org_id AND i.status = 'pending'
    ), '[]'::json)
  ) INTO result;
  
  RETURN result;
END;
$$;
