-- 1) seed_default_pipeline: ao criar pipeline padrão, conceder acesso a TODOS os membros da org
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
  SELECT id INTO v_pipeline_id
  FROM pipelines
  WHERE organization_id = p_org_id AND is_default = true AND is_active = true
  LIMIT 1;

  IF v_pipeline_id IS NOT NULL THEN
    -- Mesmo idempotente: garantir que todos os membros tenham permissão
    INSERT INTO pipeline_permissions (pipeline_id, profile_id, created_by)
    SELECT v_pipeline_id, p.id, p.id
    FROM profiles p
    WHERE p.organization_id = p_org_id
    ON CONFLICT (pipeline_id, profile_id) DO NOTHING;
    RETURN v_pipeline_id;
  END IF;

  SELECT id INTO v_profile_id
  FROM profiles
  WHERE clerk_user_id = p_created_by AND organization_id = p_org_id
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    SELECT id INTO v_profile_id FROM profiles WHERE organization_id = p_org_id LIMIT 1;
  END IF;

  IF v_profile_id IS NULL THEN
    v_profile_id := gen_random_uuid();
  END IF;

  INSERT INTO pipelines (name, description, is_default, is_active, organization_id, created_by)
  VALUES ('Pipeline Padrão', 'Pipeline padrão da organização', true, true, p_org_id, v_profile_id)
  RETURNING id INTO v_pipeline_id;

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

  -- Conceder permissão a TODOS os membros da organização
  INSERT INTO pipeline_permissions (pipeline_id, profile_id, created_by)
  SELECT v_pipeline_id, p.id, v_profile_id
  FROM profiles p
  WHERE p.organization_id = p_org_id
  ON CONFLICT (pipeline_id, profile_id) DO NOTHING;

  RETURN v_pipeline_id;
END;
$function$;

-- 2) create_pipeline: ao criar pipeline manual, conceder a todos os membros por padrão
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

  -- Conceder acesso a TODOS os membros da org por padrão
  INSERT INTO pipeline_permissions (pipeline_id, profile_id, created_by)
  SELECT v_pipeline_id, p.id, v_created_by
  FROM profiles p
  WHERE p.organization_id = v_org_id
  ON CONFLICT (pipeline_id, profile_id) DO NOTHING;

  RETURN v_pipeline_id;
END;
$function$;

-- 3) Backfill: criar pipeline padrão para organizações que ainda não têm
DO $$
DECLARE
  v_org RECORD;
  v_creator_clerk text;
BEGIN
  FOR v_org IN
    SELECT o.id, o.owner_profile_id
    FROM organizations o
    WHERE NOT EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.organization_id = o.id AND p.is_active = true
    )
  LOOP
    SELECT clerk_user_id INTO v_creator_clerk
    FROM profiles WHERE id = v_org.owner_profile_id LIMIT 1;

    IF v_creator_clerk IS NULL THEN
      SELECT clerk_user_id INTO v_creator_clerk
      FROM profiles WHERE organization_id = v_org.id LIMIT 1;
    END IF;

    PERFORM public.seed_default_pipeline(v_org.id, COALESCE(v_creator_clerk, 'system'));
  END LOOP;
END $$;

-- 4) Backfill: conceder acesso a todos os membros para todos os pipelines ativos existentes
INSERT INTO public.pipeline_permissions (pipeline_id, profile_id, created_by)
SELECT pl.id, p.id, COALESCE(o.owner_profile_id, p.id)
FROM pipelines pl
JOIN profiles p ON p.organization_id = pl.organization_id
LEFT JOIN organizations o ON o.id = pl.organization_id
WHERE pl.is_active = true
ON CONFLICT (pipeline_id, profile_id) DO NOTHING;