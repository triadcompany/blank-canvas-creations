
-- Provision the user's profile and role record from an existing org_members entry.
-- Bypasses RLS via SECURITY DEFINER so the very first profile load can succeed
-- even when the x-clerk-user-id header isn't present in the right shape.
CREATE OR REPLACE FUNCTION public.provision_profile_from_membership(
  p_clerk_user_id text,
  p_email text,
  p_name text,
  p_avatar_url text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_role text;
  v_profile public.profiles;
BEGIN
  IF p_clerk_user_id IS NULL OR p_clerk_user_id = '' THEN
    RAISE EXCEPTION 'clerk_user_id is required';
  END IF;

  -- If a profile already exists, return it (and update display fields)
  SELECT * INTO v_profile FROM public.profiles
  WHERE clerk_user_id = p_clerk_user_id
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.profiles
       SET email = COALESCE(NULLIF(p_email, ''), email),
           name = COALESCE(NULLIF(p_name, ''), name),
           avatar_url = COALESCE(p_avatar_url, avatar_url),
           updated_at = now()
     WHERE id = v_profile.id
     RETURNING * INTO v_profile;
    RETURN v_profile;
  END IF;

  -- Look up an active org membership
  SELECT organization_id, role INTO v_org_id, v_role
  FROM public.org_members
  WHERE clerk_user_id = p_clerk_user_id AND status = 'active'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RETURN NULL; -- caller will treat as needs-onboarding
  END IF;

  INSERT INTO public.profiles (clerk_user_id, email, name, avatar_url, organization_id, onboarding_completed)
  VALUES (p_clerk_user_id, COALESCE(NULLIF(p_email, ''), p_clerk_user_id || '@unknown.local'), COALESCE(NULLIF(p_name, ''), 'User'), p_avatar_url, v_org_id, true)
  RETURNING * INTO v_profile;

  -- Best-effort role insert (don't fail if it already exists)
  BEGIN
    INSERT INTO public.user_roles (clerk_user_id, organization_id, role)
    VALUES (p_clerk_user_id, v_org_id, CASE WHEN v_role = 'admin' THEN 'admin'::app_role ELSE 'seller'::app_role END);
  EXCEPTION WHEN unique_violation THEN
    NULL;
  WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.provision_profile_from_membership(text, text, text, text) TO anon, authenticated;
