
-- Add logo_url to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Create public bucket for org logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('org-logos', 'org-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for org-logos bucket
-- Public read (logos are public)
DROP POLICY IF EXISTS "Org logos are publicly readable" ON storage.objects;
CREATE POLICY "Org logos are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'org-logos');

-- Only org admins can upload logos for their org
-- Path convention: <organization_id>/<filename>
DROP POLICY IF EXISTS "Org admins can upload their logo" ON storage.objects;
CREATE POLICY "Org admins can upload their logo"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] = public.get_my_org_id()::text
    AND public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "Org admins can update their logo" ON storage.objects;
CREATE POLICY "Org admins can update their logo"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] = public.get_my_org_id()::text
    AND public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "Org admins can delete their logo" ON storage.objects;
CREATE POLICY "Org admins can delete their logo"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] = public.get_my_org_id()::text
    AND public.get_my_role() = 'admin'
  );

-- RPC: update organization details (only admins of the org)
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
BEGIN
  -- Resolve user's active org and role from profiles + org_members
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

  UPDATE public.organizations o
  SET
    name = btrim(p_name),
    cnpj = NULLIF(btrim(p_cnpj), ''),
    logo_url = NULLIF(btrim(p_logo_url), ''),
    updated_at = now()
  WHERE o.id = v_org_id;

  -- Keep clerk_organizations name in sync (used by org switcher)
  UPDATE public.clerk_organizations co
  SET name = btrim(p_name), updated_at = now()
  WHERE co.id = v_org_id;

  RETURN QUERY
    SELECT o.id, o.name, o.cnpj, o.logo_url
    FROM public.organizations o
    WHERE o.id = v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_organization_details(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
