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

  -- Resolve created_by as a valid profiles.id (uuid).
  -- p_created_by may be either a uuid (profiles.id) or a clerk_user_id (text).
  IF p_created_by IS NOT NULL THEN
    BEGIN
      v_created_by := p_created_by::uuid;
      -- Confirm the uuid actually exists in profiles; otherwise fall back via clerk lookup
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

  -- Final fallback: resolve from the caller's clerk identity
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

  RETURN v_pipeline_id;
END;
$function$;