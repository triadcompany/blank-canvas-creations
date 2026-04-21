CREATE OR REPLACE FUNCTION public.create_pipeline_stage(
  p_pipeline_id uuid,
  p_name text,
  p_color text DEFAULT '#6B7280',
  p_created_by text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_clerk_id text;
  v_created_by uuid;
  v_position int;
  v_stage_id uuid;
BEGIN
  SELECT organization_id INTO v_org_id FROM pipelines WHERE id = p_pipeline_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  -- Resolver autor
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

  -- Fallback: dono da org
  IF v_created_by IS NULL THEN
    SELECT owner_profile_id INTO v_created_by FROM organizations WHERE id = v_org_id;
  END IF;

  IF v_created_by IS NULL THEN
    RAISE EXCEPTION 'Could not resolve creator profile id';
  END IF;

  SELECT COALESCE(MAX(position), 0) + 1 INTO v_position
  FROM pipeline_stages
  WHERE pipeline_id = p_pipeline_id;

  INSERT INTO pipeline_stages (name, color, position, pipeline_id, created_by, is_active)
  VALUES (p_name, p_color, v_position, p_pipeline_id, v_created_by, true)
  RETURNING id INTO v_stage_id;

  RETURN v_stage_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_pipeline_stage(uuid, text, text, text) TO anon, authenticated;