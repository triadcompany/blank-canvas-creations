CREATE OR REPLACE FUNCTION public.delete_pipeline_rpc(
  p_clerk_user_id text,
  p_pipeline_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline_org uuid;
  v_member_role text;
  v_active_count int;
BEGIN
  -- Get pipeline org
  SELECT organization_id INTO v_pipeline_org
  FROM pipelines
  WHERE id = p_pipeline_id
  LIMIT 1;

  IF v_pipeline_org IS NULL THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  -- Validate user is admin in that org
  SELECT role INTO v_member_role
  FROM org_members
  WHERE clerk_user_id = p_clerk_user_id
    AND organization_id = v_pipeline_org
    AND status = 'active'
  LIMIT 1;

  IF v_member_role IS NULL THEN
    RAISE EXCEPTION 'Forbidden: not a member of this organization';
  END IF;

  IF v_member_role <> 'admin' THEN
    RAISE EXCEPTION 'Forbidden: only admins can delete pipelines';
  END IF;

  -- Don't allow deleting the last active pipeline
  SELECT count(*) INTO v_active_count
  FROM pipelines
  WHERE organization_id = v_pipeline_org AND is_active = true;

  IF v_active_count <= 1 THEN
    RAISE EXCEPTION 'Você deve manter pelo menos um pipeline ativo';
  END IF;

  -- Soft delete stages
  UPDATE pipeline_stages
  SET is_active = false
  WHERE pipeline_id = p_pipeline_id;

  -- Soft delete pipeline
  UPDATE pipelines
  SET is_active = false, is_default = false
  WHERE id = p_pipeline_id;

  -- If we removed the default, promote the oldest remaining active pipeline
  IF NOT EXISTS (
    SELECT 1 FROM pipelines
    WHERE organization_id = v_pipeline_org AND is_active = true AND is_default = true
  ) THEN
    UPDATE pipelines
    SET is_default = true
    WHERE id = (
      SELECT id FROM pipelines
      WHERE organization_id = v_pipeline_org AND is_active = true
      ORDER BY created_at ASC
      LIMIT 1
    );
  END IF;

  RETURN json_build_object('ok', true, 'pipeline_id', p_pipeline_id);
END;
$function$;