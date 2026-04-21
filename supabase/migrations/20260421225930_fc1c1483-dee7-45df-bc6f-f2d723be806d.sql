-- 1) Backfill profiles a partir de users_profile + org_members
INSERT INTO public.profiles (id, clerk_user_id, organization_id, email, name, avatar_url, onboarding_completed)
SELECT
  up.id,
  up.clerk_user_id,
  om.organization_id,
  COALESCE(up.email, up.clerk_user_id || '@unknown.local'),
  COALESCE(up.full_name, up.email, 'Usuário'),
  up.avatar_url,
  true
FROM users_profile up
JOIN org_members om ON om.clerk_user_id = up.clerk_user_id AND om.status = 'active'
WHERE NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.clerk_user_id = up.clerk_user_id)
ON CONFLICT (id) DO NOTHING;

-- Para usuários em múltiplas orgs, garantir que cada org tenha pelo menos uma referência:
-- já existe a profile principal, suficiente para resolver clerk_user_id -> profile_id.

-- 2) Atualizar organization_id em profiles para casos onde está NULL
UPDATE public.profiles p
SET organization_id = om.organization_id
FROM org_members om
WHERE om.clerk_user_id = p.clerk_user_id
  AND om.status = 'active'
  AND p.organization_id IS NULL;

-- 3) Backfill owner_profile_id em organizations
UPDATE public.organizations o
SET owner_profile_id = p.id
FROM clerk_organizations co
JOIN profiles p ON p.clerk_user_id = co.created_by_clerk_user_id
WHERE co.name = o.name
  AND co.deleted_at IS NULL
  AND o.owner_profile_id IS NULL;

-- 4) Atualizar seed_default_pipeline para conceder permissão a TODOS via org_members
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
    -- Garantir permissão para todos os membros via org_members
    INSERT INTO pipeline_permissions (pipeline_id, profile_id, created_by)
    SELECT v_pipeline_id, p.id, p.id
    FROM org_members om
    JOIN profiles p ON p.clerk_user_id = om.clerk_user_id
    WHERE om.organization_id = p_org_id AND om.status = 'active'
    ON CONFLICT (pipeline_id, profile_id) DO NOTHING;
    RETURN v_pipeline_id;
  END IF;

  -- Resolver criador via profiles
  SELECT id INTO v_profile_id
  FROM profiles
  WHERE clerk_user_id = p_created_by
  LIMIT 1;

  -- Fallback: qualquer admin da org
  IF v_profile_id IS NULL THEN
    SELECT p.id INTO v_profile_id
    FROM org_members om
    JOIN profiles p ON p.clerk_user_id = om.clerk_user_id
    WHERE om.organization_id = p_org_id AND om.status = 'active'
    ORDER BY CASE WHEN om.role = 'admin' THEN 0 ELSE 1 END
    LIMIT 1;
  END IF;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed pipeline: no profile found for org %', p_org_id;
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

  -- Permissão para todos os membros via org_members
  INSERT INTO pipeline_permissions (pipeline_id, profile_id, created_by)
  SELECT v_pipeline_id, p.id, v_profile_id
  FROM org_members om
  JOIN profiles p ON p.clerk_user_id = om.clerk_user_id
  WHERE om.organization_id = p_org_id AND om.status = 'active'
  ON CONFLICT (pipeline_id, profile_id) DO NOTHING;

  RETURN v_pipeline_id;
END;
$function$;

-- 5) Atualizar create_pipeline para conceder a todos via org_members
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

  -- Permissão para todos os membros via org_members
  INSERT INTO pipeline_permissions (pipeline_id, profile_id, created_by)
  SELECT v_pipeline_id, p.id, v_created_by
  FROM org_members om
  JOIN profiles p ON p.clerk_user_id = om.clerk_user_id
  WHERE om.organization_id = v_org_id AND om.status = 'active'
  ON CONFLICT (pipeline_id, profile_id) DO NOTHING;

  RETURN v_pipeline_id;
END;
$function$;

-- 6) Limpar pipelines órfãos: created_by inválido (profile inexistente) sem stages e sem permissões
DELETE FROM pipelines
WHERE created_by NOT IN (SELECT id FROM profiles)
  AND NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.pipeline_id = pipelines.id)
  AND NOT EXISTS (SELECT 1 FROM pipeline_permissions pp WHERE pp.pipeline_id = pipelines.id);

-- 7) Backfill: garantir pipeline padrão em toda organização
DO $$
DECLARE
  v_org RECORD;
  v_creator_clerk text;
BEGIN
  FOR v_org IN
    SELECT o.id
    FROM organizations o
    WHERE NOT EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.organization_id = o.id AND p.is_active = true
    )
    AND EXISTS (
      SELECT 1 FROM org_members om
      JOIN profiles p ON p.clerk_user_id = om.clerk_user_id
      WHERE om.organization_id = o.id AND om.status = 'active'
    )
  LOOP
    SELECT om.clerk_user_id INTO v_creator_clerk
    FROM org_members om
    JOIN profiles p ON p.clerk_user_id = om.clerk_user_id
    WHERE om.organization_id = v_org.id AND om.status = 'active'
    ORDER BY CASE WHEN om.role = 'admin' THEN 0 ELSE 1 END
    LIMIT 1;

    PERFORM public.seed_default_pipeline(v_org.id, v_creator_clerk);
  END LOOP;
END $$;

-- 8) Backfill: liberar acesso a todos os membros nos pipelines ativos
INSERT INTO public.pipeline_permissions (pipeline_id, profile_id, created_by)
SELECT pl.id, p.id, COALESCE(o.owner_profile_id, p.id)
FROM pipelines pl
JOIN organizations o ON o.id = pl.organization_id
JOIN org_members om ON om.organization_id = pl.organization_id AND om.status = 'active'
JOIN profiles p ON p.clerk_user_id = om.clerk_user_id
WHERE pl.is_active = true
ON CONFLICT (pipeline_id, profile_id) DO NOTHING;