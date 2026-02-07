-- Atualizar a função para criar pipeline padrão para organizações existentes
CREATE OR REPLACE FUNCTION public.create_default_pipeline_for_existing_orgs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  org_record RECORD;
  admin_profile_id uuid;
  pipeline_id uuid;
BEGIN
  -- Para cada organização que não tem pipeline
  FOR org_record IN 
    SELECT DISTINCT o.id as org_id, o.name as org_name
    FROM organizations o
    WHERE o.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM pipelines p 
      WHERE p.organization_id = o.id AND p.is_active = true
    )
  LOOP
    -- Encontrar um admin da organização
    SELECT p.id INTO admin_profile_id
    FROM profiles p
    WHERE p.organization_id = org_record.org_id 
    AND p.role = 'admin'
    LIMIT 1;
    
    -- Se não encontrar admin, pegar qualquer usuário da organização
    IF admin_profile_id IS NULL THEN
      SELECT p.id INTO admin_profile_id
      FROM profiles p
      WHERE p.organization_id = org_record.org_id
      LIMIT 1;
    END IF;
    
    -- Se encontrou um usuário, criar o pipeline
    IF admin_profile_id IS NOT NULL THEN
      -- Criar pipeline padrão
      INSERT INTO public.pipelines (
        name,
        description,
        is_default,
        is_active,
        organization_id,
        created_by
      ) VALUES (
        'Pipeline de Vendas',
        'Pipeline padrão criado automaticamente para sua organização',
        true,
        true,
        org_record.org_id,
        admin_profile_id
      ) RETURNING id INTO pipeline_id;
      
      -- Criar estágios padrão atualizados
      INSERT INTO public.pipeline_stages (name, position, color, pipeline_id, created_by) VALUES
        ('Novo Lead', 1, '#6B7280', pipeline_id, admin_profile_id),
        ('Andamento', 2, '#3B82F6', pipeline_id, admin_profile_id),
        ('Qualificado', 3, '#10B981', pipeline_id, admin_profile_id),
        ('Agendado', 4, '#F59E0B', pipeline_id, admin_profile_id),
        ('Proposta Enviada', 5, '#8B5CF6', pipeline_id, admin_profile_id),
        ('Venda', 6, '#22C55E', pipeline_id, admin_profile_id),
        ('Follow Up', 7, '#06B6D4', pipeline_id, admin_profile_id),
        ('Perdido', 8, '#EF4444', pipeline_id, admin_profile_id);
    END IF;
  END LOOP;
END;
$function$;

-- Executar a função para organizações existentes
SELECT public.create_default_pipeline_for_existing_orgs();