-- Atualizar a função handle_new_user para criar pipeline padrão com as etapas solicitadas
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
  
  -- Create default pipeline stages with the requested stages
  INSERT INTO public.pipeline_stages (name, position, color, pipeline_id, created_by) VALUES
    ('Novo Lead', 1, '#6B7280', pipeline_id, profile_id),
    ('Andamento', 2, '#3B82F6', pipeline_id, profile_id),
    ('Qualificado', 3, '#10B981', pipeline_id, profile_id),
    ('Agendado', 4, '#F59E0B', pipeline_id, profile_id),
    ('Proposta Enviada', 5, '#8B5CF6', pipeline_id, profile_id),
    ('Venda', 6, '#22C55E', pipeline_id, profile_id),
    ('Follow Up', 7, '#06B6D4', pipeline_id, profile_id),
    ('Perdido', 8, '#EF4444', pipeline_id, profile_id);
  
  RETURN NEW;
END;
$function$;