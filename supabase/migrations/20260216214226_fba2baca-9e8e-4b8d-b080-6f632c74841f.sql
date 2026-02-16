
CREATE OR REPLACE FUNCTION public.create_pipeline(
  p_name text,
  p_description text DEFAULT NULL,
  p_org_id uuid DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_pipeline_id uuid;
  v_count int;
BEGIN
  -- Resolve org from parameter or caller
  v_org_id := COALESCE(p_org_id, get_my_org_id());
  
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  -- Check pipeline limit
  SELECT count(*) INTO v_count FROM pipelines WHERE organization_id = v_org_id AND is_active = true;
  IF v_count >= 10 THEN
    RAISE EXCEPTION 'Pipeline limit reached (max 10)';
  END IF;

  INSERT INTO pipelines (name, description, organization_id, created_by, is_default, is_active)
  VALUES (p_name, p_description, v_org_id, COALESCE(p_created_by, get_clerk_user_id()), false, true)
  RETURNING id INTO v_pipeline_id;

  RETURN v_pipeline_id;
END;
$$;
