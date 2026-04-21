-- 1. Add owner_profile_id to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS owner_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_owner_profile_id ON public.organizations(owner_profile_id);

UPDATE public.organizations o
SET owner_profile_id = sub.profile_id
FROM (
  SELECT DISTINCT ON (o2.id)
    o2.id AS org_id,
    p.id AS profile_id
  FROM public.organizations o2
  JOIN public.clerk_organizations co ON co.name = o2.name AND co.deleted_at IS NULL
  JOIN public.profiles p ON p.clerk_user_id = co.created_by_clerk_user_id
  ORDER BY o2.id, co.created_at DESC
) sub
WHERE o.id = sub.org_id AND o.owner_profile_id IS NULL;

-- 2. pipeline_permissions table
CREATE TABLE IF NOT EXISTS public.pipeline_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_permissions_pipeline ON public.pipeline_permissions(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_permissions_profile ON public.pipeline_permissions(profile_id);

ALTER TABLE public.pipeline_permissions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_org_owner(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organizations o
    JOIN profiles p ON p.id = o.owner_profile_id
    WHERE o.id = _org_id
      AND p.clerk_user_id = get_clerk_user_id()
  );
$$;

DROP POLICY IF EXISTS "pipeline_permissions_select_own" ON public.pipeline_permissions;
CREATE POLICY "pipeline_permissions_select_own"
ON public.pipeline_permissions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = pipeline_permissions.pipeline_id
      AND public.is_org_owner(p.organization_id)
  )
  OR profile_id IN (SELECT id FROM profiles WHERE clerk_user_id = get_clerk_user_id())
);

DROP POLICY IF EXISTS "pipeline_permissions_admin_manage" ON public.pipeline_permissions;
CREATE POLICY "pipeline_permissions_admin_manage"
ON public.pipeline_permissions
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = pipeline_permissions.pipeline_id
      AND (
        public.is_org_owner(p.organization_id)
        OR public.has_role(
          (SELECT id FROM profiles WHERE clerk_user_id = get_clerk_user_id() LIMIT 1),
          'admin'::app_role
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = pipeline_permissions.pipeline_id
      AND (
        public.is_org_owner(p.organization_id)
        OR public.has_role(
          (SELECT id FROM profiles WHERE clerk_user_id = get_clerk_user_id() LIMIT 1),
          'admin'::app_role
        )
      )
  )
);

-- 3. get_org_pipelines: filter by permissions (owner sees all)
CREATE OR REPLACE FUNCTION public.get_org_pipelines(p_org_id uuid)
RETURNS SETOF pipelines
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_clerk_id text;
  v_profile_id uuid;
  v_is_owner boolean;
BEGIN
  v_clerk_id := get_clerk_user_id();
  SELECT id INTO v_profile_id FROM profiles WHERE clerk_user_id = v_clerk_id LIMIT 1;
  v_is_owner := public.is_org_owner(p_org_id);

  IF v_is_owner THEN
    RETURN QUERY
      SELECT * FROM pipelines
      WHERE organization_id = p_org_id AND is_active = true
      ORDER BY is_default DESC, created_at ASC;
  ELSE
    RETURN QUERY
      SELECT pl.* FROM pipelines pl
      WHERE pl.organization_id = p_org_id
        AND pl.is_active = true
        AND EXISTS (
          SELECT 1 FROM pipeline_permissions pp
          WHERE pp.pipeline_id = pl.id
            AND pp.profile_id = v_profile_id
        )
      ORDER BY pl.is_default DESC, pl.created_at ASC;
  END IF;
END;
$function$;

-- 4. create_pipeline: auto-grant creator
CREATE OR REPLACE FUNCTION public.create_pipeline(
  p_name text,
  p_description text DEFAULT NULL::text,
  p_org_id uuid DEFAULT NULL::uuid,
  p_created_by text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_pipeline_id uuid;
  v_count int;
  v_created_by uuid;
  v_clerk_id text;
BEGIN
  v_org_id := COALESCE(p_org_id, get_my_org_id());
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  SELECT count(*) INTO v_count FROM pipelines WHERE organization_id = v_org_id AND is_active = true;
  IF v_count >= 10 THEN
    RAISE EXCEPTION 'Pipeline limit reached (max 10)';
  END IF;

  IF p_created_by IS NOT NULL THEN
    BEGIN
      v_created_by := p_created_by::uuid;
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_created_by) THEN
        v_created_by := NULL;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      v_created_by := NULL;
    END;

    IF v_created_by IS NULL THEN
      SELECT id INTO v_created_by FROM profiles WHERE clerk_user_id = p_created_by LIMIT 1;
    END IF;
  END IF;

  IF v_created_by IS NULL THEN
    v_clerk_id := get_clerk_user_id();
    IF v_clerk_id IS NOT NULL THEN
      SELECT id INTO v_created_by FROM profiles WHERE clerk_user_id = v_clerk_id LIMIT 1;
    END IF;
  END IF;

  IF v_created_by IS NULL THEN
    RAISE EXCEPTION 'Could not resolve creator profile id';
  END IF;

  INSERT INTO pipelines (name, description, organization_id, created_by, is_default, is_active)
  VALUES (p_name, p_description, v_org_id, v_created_by, false, true)
  RETURNING id INTO v_pipeline_id;

  INSERT INTO pipeline_permissions (pipeline_id, profile_id, created_by)
  VALUES (v_pipeline_id, v_created_by, v_created_by)
  ON CONFLICT (pipeline_id, profile_id) DO NOTHING;

  RETURN v_pipeline_id;
END;
$function$;

-- 5. Backfill existing pipelines: owner + valid creator
INSERT INTO public.pipeline_permissions (pipeline_id, profile_id, created_by)
SELECT pl.id, o.owner_profile_id, o.owner_profile_id
FROM pipelines pl
JOIN organizations o ON o.id = pl.organization_id
WHERE o.owner_profile_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = o.owner_profile_id)
ON CONFLICT (pipeline_id, profile_id) DO NOTHING;

INSERT INTO public.pipeline_permissions (pipeline_id, profile_id, created_by)
SELECT pl.id, pl.created_by, pl.created_by
FROM pipelines pl
WHERE pl.created_by IS NOT NULL
  AND EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = pl.created_by)
ON CONFLICT (pipeline_id, profile_id) DO NOTHING;

-- 6. RPCs for the UI
CREATE OR REPLACE FUNCTION public.list_pipeline_permissions(p_pipeline_id uuid)
RETURNS TABLE (profile_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pp.profile_id FROM pipeline_permissions pp WHERE pp.pipeline_id = p_pipeline_id;
$$;

CREATE OR REPLACE FUNCTION public.set_pipeline_permissions(
  p_pipeline_id uuid,
  p_profile_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_clerk_id text;
  v_caller_profile_id uuid;
  v_is_admin boolean;
  v_is_owner boolean;
  v_owner_profile_id uuid;
BEGIN
  SELECT pl.organization_id INTO v_org_id FROM pipelines pl WHERE pl.id = p_pipeline_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  v_clerk_id := get_clerk_user_id();
  SELECT id INTO v_caller_profile_id FROM profiles WHERE clerk_user_id = v_clerk_id LIMIT 1;
  v_is_owner := public.is_org_owner(v_org_id);
  v_is_admin := public.has_role(v_caller_profile_id, 'admin'::app_role);

  IF NOT (v_is_owner OR v_is_admin) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT owner_profile_id INTO v_owner_profile_id FROM organizations WHERE id = v_org_id;

  DELETE FROM pipeline_permissions
  WHERE pipeline_id = p_pipeline_id
    AND (v_owner_profile_id IS NULL OR profile_id <> v_owner_profile_id);

  IF p_profile_ids IS NOT NULL AND array_length(p_profile_ids, 1) > 0 THEN
    INSERT INTO pipeline_permissions (pipeline_id, profile_id, created_by)
    SELECT p_pipeline_id, pid, v_caller_profile_id
    FROM unnest(p_profile_ids) AS pid
    WHERE (v_owner_profile_id IS NULL OR pid <> v_owner_profile_id)
      AND EXISTS (SELECT 1 FROM profiles WHERE id = pid)
    ON CONFLICT (pipeline_id, profile_id) DO NOTHING;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pipeline_permissions(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_pipeline_permissions(uuid, uuid[]) TO anon, authenticated;