
CREATE OR REPLACE FUNCTION public.switch_active_organization(
  p_clerk_user_id text,
  p_organization_id uuid
)
RETURNS TABLE (organization_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_clerk_user_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'clerk_user_id and organization_id are required';
  END IF;

  -- Verify the user is actually a member of the target organization
  SELECT om.role INTO v_role
  FROM public.org_members om
  WHERE om.clerk_user_id = p_clerk_user_id
    AND om.organization_id = p_organization_id
    AND COALESCE(om.status, 'active') = 'active'
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'User is not a member of organization %', p_organization_id;
  END IF;

  -- Persist the active org on profiles (bypasses RLS via SECURITY DEFINER)
  UPDATE public.profiles
  SET organization_id = p_organization_id,
      updated_at = now()
  WHERE clerk_user_id = p_clerk_user_id;

  -- Mirror the role into user_roles for the new org context if the table exists
  BEGIN
    INSERT INTO public.user_roles (clerk_user_id, organization_id, role)
    VALUES (p_clerk_user_id, p_organization_id, v_role::app_role)
    ON CONFLICT (clerk_user_id, organization_id) DO UPDATE SET role = EXCLUDED.role;
  EXCEPTION WHEN OTHERS THEN
    -- user_roles table/columns may differ; not critical for switching
    NULL;
  END;

  RETURN QUERY SELECT p_organization_id, v_role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.switch_active_organization(text, uuid) TO anon, authenticated, service_role;
