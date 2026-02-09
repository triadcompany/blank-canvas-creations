
-- 1) Função idempotente para criar pipeline padrão
CREATE OR REPLACE FUNCTION public.seed_default_pipeline(p_org_id uuid, p_created_by text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pipeline_id uuid;
  v_profile_id uuid;
BEGIN
  -- Verificar se já existe pipeline default para esta org
  SELECT id INTO v_pipeline_id
  FROM pipelines
  WHERE organization_id = p_org_id AND is_default = true AND is_active = true
  LIMIT 1;

  -- Se já existe, retornar o ID existente
  IF v_pipeline_id IS NOT NULL THEN
    RETURN v_pipeline_id;
  END IF;

  -- Buscar profile_id do criador (clerk_user_id)
  SELECT id INTO v_profile_id
  FROM profiles
  WHERE clerk_user_id = p_created_by AND organization_id = p_org_id
  LIMIT 1;

  -- Fallback: buscar qualquer profile da org
  IF v_profile_id IS NULL THEN
    SELECT id INTO v_profile_id
    FROM profiles
    WHERE organization_id = p_org_id
    LIMIT 1;
  END IF;

  -- Se não encontrou nenhum profile, usar UUID placeholder
  IF v_profile_id IS NULL THEN
    v_profile_id := gen_random_uuid();
  END IF;

  -- Criar pipeline padrão
  INSERT INTO pipelines (name, description, is_default, is_active, organization_id, created_by)
  VALUES ('Pipeline Principal', 'Pipeline padrão da organização', true, true, p_org_id, v_profile_id)
  RETURNING id INTO v_pipeline_id;

  -- Criar etapas padrão
  INSERT INTO pipeline_stages (name, position, color, pipeline_id, created_by, is_active) VALUES
    ('Novo Lead',          1, '#6B7280', v_pipeline_id, v_profile_id, true),
    ('Andamento',          2, '#3B82F6', v_pipeline_id, v_profile_id, true),
    ('Qualificado',        3, '#10B981', v_pipeline_id, v_profile_id, true),
    ('Agendado',           4, '#F59E0B', v_pipeline_id, v_profile_id, true),
    ('Visita Realizada',   5, '#8B5CF6', v_pipeline_id, v_profile_id, true),
    ('Venda',              6, '#22C55E', v_pipeline_id, v_profile_id, true),
    ('Follow Up',          7, '#06B6D4', v_pipeline_id, v_profile_id, true),
    ('Perdido',            8, '#EF4444', v_pipeline_id, v_profile_id, true),
    ('Desqualificado',     9, '#9CA3AF', v_pipeline_id, v_profile_id, true);

  RETURN v_pipeline_id;
END;
$$;

-- 2) Trigger para auto-atribuir "Novo Lead" a leads sem stage_id
CREATE OR REPLACE FUNCTION public.auto_assign_default_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_default_stage_id uuid;
BEGIN
  -- Só atribuir se stage_id for NULL
  IF NEW.stage_id IS NULL AND NEW.organization_id IS NOT NULL THEN
    -- Buscar o stage "Novo Lead" (position=1) do pipeline default da org
    SELECT ps.id INTO v_default_stage_id
    FROM pipeline_stages ps
    JOIN pipelines p ON ps.pipeline_id = p.id
    WHERE p.organization_id = NEW.organization_id
      AND p.is_default = true
      AND p.is_active = true
      AND ps.is_active = true
      AND ps.position = 1
    LIMIT 1;

    IF v_default_stage_id IS NOT NULL THEN
      NEW.stage_id := v_default_stage_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Criar trigger no INSERT de leads
DROP TRIGGER IF EXISTS auto_assign_lead_stage ON public.leads;
CREATE TRIGGER auto_assign_lead_stage
  BEFORE INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_default_stage();
