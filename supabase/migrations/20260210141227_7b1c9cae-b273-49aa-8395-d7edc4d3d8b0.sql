
-- 1) Replace seed_default_pipeline with the user's requested 9 stages
CREATE OR REPLACE FUNCTION public.seed_default_pipeline(p_org_id uuid, p_created_by text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline_id uuid;
  v_profile_id uuid;
BEGIN
  -- Check if default pipeline already exists for this org
  SELECT id INTO v_pipeline_id
  FROM pipelines
  WHERE organization_id = p_org_id AND is_default = true AND is_active = true
  LIMIT 1;

  -- If exists, return existing ID (idempotent)
  IF v_pipeline_id IS NOT NULL THEN
    RETURN v_pipeline_id;
  END IF;

  -- Find profile_id of creator
  SELECT id INTO v_profile_id
  FROM profiles
  WHERE clerk_user_id = p_created_by AND organization_id = p_org_id
  LIMIT 1;

  -- Fallback: any profile in the org
  IF v_profile_id IS NULL THEN
    SELECT id INTO v_profile_id
    FROM profiles
    WHERE organization_id = p_org_id
    LIMIT 1;
  END IF;

  -- Final fallback: placeholder UUID
  IF v_profile_id IS NULL THEN
    v_profile_id := gen_random_uuid();
  END IF;

  -- Create default pipeline
  INSERT INTO pipelines (name, description, is_default, is_active, organization_id, created_by)
  VALUES ('Pipeline Padrão', 'Pipeline padrão da organização', true, true, p_org_id, v_profile_id)
  RETURNING id INTO v_pipeline_id;

  -- Create 9 default stages
  INSERT INTO pipeline_stages (name, position, color, pipeline_id, created_by, is_active) VALUES
    ('Novo Lead',            1, '#6B7280', v_pipeline_id, v_profile_id, true),
    ('Andamento',            2, '#3B82F6', v_pipeline_id, v_profile_id, true),
    ('Qualificado',          3, '#10B981', v_pipeline_id, v_profile_id, true),
    ('Agendado',             4, '#F59E0B', v_pipeline_id, v_profile_id, true),
    ('Visita Realizada',     5, '#8B5CF6', v_pipeline_id, v_profile_id, true),
    ('Negociando Proposta',  6, '#EC4899', v_pipeline_id, v_profile_id, true),
    ('Venda',                7, '#22C55E', v_pipeline_id, v_profile_id, true),
    ('Follow Up',            8, '#06B6D4', v_pipeline_id, v_profile_id, true),
    ('Perdido',              9, '#EF4444', v_pipeline_id, v_profile_id, true);

  RETURN v_pipeline_id;
END;
$function$;

-- 2) Create ensure_default_pipeline wrapper that can be called from frontend
CREATE OR REPLACE FUNCTION public.ensure_default_pipeline(p_org_id uuid, p_created_by text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN seed_default_pipeline(p_org_id, p_created_by);
END;
$function$;

-- 3) Create RPC to fetch pipelines for an org (bypasses RLS for Clerk users)
CREATE OR REPLACE FUNCTION public.get_org_pipelines(p_org_id uuid)
 RETURNS SETOF pipelines
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM pipelines
  WHERE organization_id = p_org_id
    AND is_active = true
  ORDER BY is_default DESC, created_at ASC;
END;
$function$;

-- 4) Create RPC to fetch pipeline stages (bypasses RLS for Clerk users)
CREATE OR REPLACE FUNCTION public.get_pipeline_stages(p_pipeline_id uuid)
 RETURNS SETOF pipeline_stages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM pipeline_stages
  WHERE pipeline_id = p_pipeline_id
    AND is_active = true
  ORDER BY position ASC;
END;
$function$;

-- 5) Unique partial index to prevent duplicate default pipelines per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_default_pipeline_per_org
  ON pipelines (organization_id)
  WHERE is_default = true AND is_active = true;
