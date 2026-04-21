
-- Backfill: copy clerk_organizations rows into organizations
INSERT INTO public.organizations (id, name, is_active, created_at, updated_at)
SELECT co.id, co.name, true, co.created_at, co.updated_at
FROM public.clerk_organizations co
LEFT JOIN public.organizations o ON o.id = co.id
WHERE o.id IS NULL
  AND co.deleted_at IS NULL;

-- Update RPC to upsert (create row if missing, using clerk_organizations name as seed)
CREATE OR REPLACE FUNCTION public.update_organization_details(
  p_clerk_user_id TEXT,
  p_name TEXT,
  p_cnpj TEXT,
  p_logo_url TEXT
)
RETURNS TABLE(id UUID, name TEXT, cnpj TEXT, logo_url TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_role TEXT;
  v_seed_name TEXT;
BEGIN
  SELECT p.organization_id INTO v_org_id
  FROM public.profiles p
  WHERE p.clerk_user_id = p_clerk_user_id
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found for user';
  END IF;

  SELECT om.role INTO v_role
  FROM public.org_members om
  WHERE om.clerk_user_id = p_clerk_user_id
    AND om.organization_id = v_org_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can update organization details';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  -- Ensure organizations row exists (seed from clerk_organizations if missing)
  SELECT co.name INTO v_seed_name
  FROM public.clerk_organizations co
  WHERE co.id = v_org_id;

  INSERT INTO public.organizations (id, name, is_active, created_at, updated_at)
  VALUES (v_org_id, COALESCE(v_seed_name, btrim(p_name)), true, now(), now())
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.organizations o
  SET
    name = btrim(p_name),
    cnpj = NULLIF(btrim(p_cnpj), ''),
    logo_url = NULLIF(btrim(p_logo_url), ''),
    updated_at = now()
  WHERE o.id = v_org_id;

  UPDATE public.clerk_organizations co
  SET name = btrim(p_name), updated_at = now()
  WHERE co.id = v_org_id;

  RETURN QUERY
    SELECT o.id, o.name, o.cnpj, o.logo_url
    FROM public.organizations o
    WHERE o.id = v_org_id;
END;
$$;
