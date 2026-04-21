-- 1) Atualiza estágios "Desqualificado" existentes em pipelines padrão
UPDATE public.pipeline_stages ps
SET color = '#F97316'
FROM public.pipelines p
WHERE ps.pipeline_id = p.id
  AND p.is_default = true
  AND ps.name = 'Desqualificado';

-- 2) Atualiza a função de seed para que novos pipelines padrão já nasçam com a cor correta
CREATE OR REPLACE FUNCTION public.seed_default_pipeline(p_organization_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_id uuid;
  v_profile_id uuid;
BEGIN
  -- Skip if a default pipeline already exists for the org
  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = p_organization_id
    AND is_default = true
  LIMIT 1;

  IF v_pipeline_id IS NOT NULL THEN
    RETURN v_pipeline_id;
  END IF;

  -- Pick any profile inside the org to satisfy created_by NOT NULL constraints
  SELECT id INTO v_profile_id
  FROM public.profiles
  WHERE organization_id = p_organization_id
  ORDER BY created_at ASC
  LIMIT 1;

  -- Create the default pipeline
  INSERT INTO public.pipelines (name, description, organization_id, created_by, is_default, is_active)
  VALUES ('Pipeline Principal', 'Pipeline padrão da organização', p_organization_id, v_profile_id, true, true)
  RETURNING id INTO v_pipeline_id;

  -- Seed the default stages
  INSERT INTO public.pipeline_stages (name, "order", color, pipeline_id, created_by, is_active)
  VALUES
    ('Novo Lead',          1,  '#3B82F6', v_pipeline_id, v_profile_id, true),
    ('Andamento',          2,  '#8B5CF6', v_pipeline_id, v_profile_id, true),
    ('Qualificação',       3,  '#A855F7', v_pipeline_id, v_profile_id, true),
    ('Negociação',         4,  '#F59E0B', v_pipeline_id, v_profile_id, true),
    ('Proposta enviada',   5,  '#10B981', v_pipeline_id, v_profile_id, true),
    ('Vendido',            6,  '#22C55E', v_pipeline_id, v_profile_id, true),
    ('Pós-venda',          7,  '#14B8A6', v_pipeline_id, v_profile_id, true),
    ('Follow Up',          8,  '#06B6D4', v_pipeline_id, v_profile_id, true),
    ('Perdido',            9,  '#EF4444', v_pipeline_id, v_profile_id, true),
    ('Desqualificado',     10, '#F97316', v_pipeline_id, v_profile_id, true);

  RETURN v_pipeline_id;
END;
$$;