CREATE OR REPLACE FUNCTION public.get_organization_details(
  p_clerk_user_id TEXT,
  p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE(out_id UUID, out_name TEXT, out_cnpj TEXT, out_logo_url TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Resolve org id: use provided or fall back to user's active membership
  IF p_organization_id IS NOT NULL THEN
    -- Validate caller belongs to this org
    SELECT om.organization_id INTO v_org_id
    FROM public.org_members om
    WHERE om.clerk_user_id = p_clerk_user_id
      AND om.organization_id = p_organization_id
      AND om.status = 'active'
    LIMIT 1;
  ELSE
    SELECT om.organization_id INTO v_org_id
    FROM public.org_members om
    WHERE om.clerk_user_id = p_clerk_user_id
      AND om.status = 'active'
    ORDER BY om.created_at DESC
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organization membership found for user';
  END IF;

  RETURN QUERY
  SELECT o.id, o.name, o.cnpj, o.logo_url
  FROM public.organizations o
  WHERE o.id = v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_organization_details(TEXT, UUID) TO authenticated, anon;