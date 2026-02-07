-- Atualizar a função handle_new_user para criar pipeline padrão com estágios específicos
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  org_id uuid;
  profile_id uuid;
  pipeline_id uuid;
BEGIN
  -- Create organization first
  INSERT INTO public.organizations (
    id,
    name,
    email,
    is_active
  ) VALUES (
    gen_random_uuid(),
    COALESCE(NEW.raw_user_meta_data ->> 'organization_name', 'Minha Empresa'),
    NEW.email,
    true
  ) RETURNING id INTO org_id;
  
  -- Create user profile with admin role and organization
  INSERT INTO public.profiles (
    user_id, 
    name, 
    email, 
    role,
    organization_id
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', NEW.email),
    NEW.email,
    'admin',
    org_id
  ) RETURNING id INTO profile_id;
  
  -- Create default pipeline for the organization
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
    org_id,
    profile_id
  ) RETURNING id INTO pipeline_id;
  
  -- Create default pipeline stages
  INSERT INTO public.pipeline_stages (name, position, color, pipeline_id, created_by) VALUES
    ('Novo lead', 1, '#6B7280', pipeline_id, profile_id),
    ('Andamento', 2, '#3B82F6', pipeline_id, profile_id),
    ('Qualificado', 3, '#10B981', pipeline_id, profile_id),
    ('Agendamento', 4, '#F59E0B', pipeline_id, profile_id),
    ('Proposta Enviada', 5, '#8B5CF6', pipeline_id, profile_id),
    ('Fechado', 6, '#22C55E', pipeline_id, profile_id),
    ('Follow Up', 7, '#06B6D4', pipeline_id, profile_id),
    ('Perdido', 8, '#EF4444', pipeline_id, profile_id),
    ('Chamar mais pra frente', 9, '#F97316', pipeline_id, profile_id);
  
  RETURN NEW;
END;
$function$;

-- Criar função para adicionar estágios padrão a organizações existentes que não têm pipeline
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
      
      -- Criar estágios padrão
      INSERT INTO public.pipeline_stages (name, position, color, pipeline_id, created_by) VALUES
        ('Novo lead', 1, '#6B7280', pipeline_id, admin_profile_id),
        ('Andamento', 2, '#3B82F6', pipeline_id, admin_profile_id),
        ('Qualificado', 3, '#10B981', pipeline_id, admin_profile_id),
        ('Agendamento', 4, '#F59E0B', pipeline_id, admin_profile_id),
        ('Proposta Enviada', 5, '#8B5CF6', pipeline_id, admin_profile_id),
        ('Fechado', 6, '#22C55E', pipeline_id, admin_profile_id),
        ('Follow Up', 7, '#06B6D4', pipeline_id, admin_profile_id),
        ('Perdido', 8, '#EF4444', pipeline_id, admin_profile_id),
        ('Chamar mais pra frente', 9, '#F97316', pipeline_id, admin_profile_id);
    END IF;
  END LOOP;
END;
$function$;

-- Executar a função para organizações existentes
SELECT public.create_default_pipeline_for_existing_orgs();