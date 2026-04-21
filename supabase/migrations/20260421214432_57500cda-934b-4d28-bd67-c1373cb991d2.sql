CREATE OR REPLACE FUNCTION public.get_user_organizations_with_logos(
  p_clerk_user_id TEXT
)
RETURNS TABLE(
  organization_id UUID,
  clerk_org_id TEXT,
  role TEXT,
  org_name TEXT,
  logo_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    om.organization_id,
    om.clerk_org_id,
    om.role::TEXT,
    COALESCE(co.name, o.name) AS org_name,
    o.logo_url
  FROM public.org_members om
  LEFT JOIN public.organizations o ON o.id = om.organization_id
  LEFT JOIN public.clerk_organizations co ON co.id = om.organization_id
  WHERE om.clerk_user_id = p_clerk_user_id
    AND om.status = 'active'
    AND om.organization_id IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_organizations_with_logos(TEXT) TO authenticated, anon;