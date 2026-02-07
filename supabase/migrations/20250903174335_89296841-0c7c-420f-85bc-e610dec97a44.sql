-- Atualizar a função handle_new_user para lidar com convites existentes
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  org_id uuid;
  profile_id uuid;
  pipeline_id uuid;
  invitation_record user_invitations%ROWTYPE;
  user_role app_role := 'admin';
BEGIN
  -- Verificar se existe convite pendente para este email
  SELECT * INTO invitation_record
  FROM user_invitations 
  WHERE email = NEW.email 
  AND status IN ('pending', 'direct_creation')
  ORDER BY created_at DESC 
  LIMIT 1;
  
  IF invitation_record.id IS NOT NULL THEN
    -- Usuário foi convidado, usar dados do convite
    org_id := invitation_record.organization_id;
    user_role := invitation_record.role;
    
    -- Marcar convite como aceito
    UPDATE user_invitations 
    SET status = 'accepted' 
    WHERE id = invitation_record.id;
    
    -- Criar perfil do usuário convidado
    INSERT INTO public.profiles (
      user_id, 
      name, 
      email, 
      role,
      organization_id
    ) VALUES (
      NEW.id,
      invitation_record.name,
      NEW.email,
      user_role,
      org_id
    ) RETURNING id INTO profile_id;
  ELSE
    -- Primeiro usuário da organização (administrador)
    -- Criar organização
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
    
    -- Criar perfil do admin
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
    
    -- Criar pipeline padrão apenas para novos admins
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
    
    -- Criar estágios padrão do pipeline
    INSERT INTO public.pipeline_stages (name, position, color, pipeline_id, created_by) VALUES
      ('Novo Lead', 1, '#6B7280', pipeline_id, profile_id),
      ('Andamento', 2, '#3B82F6', pipeline_id, profile_id),
      ('Qualificado', 3, '#10B981', pipeline_id, profile_id),
      ('Agendado', 4, '#F59E0B', pipeline_id, profile_id),
      ('Proposta Enviada', 5, '#8B5CF6', pipeline_id, profile_id),
      ('Venda', 6, '#22C55E', pipeline_id, profile_id),
      ('Follow Up', 7, '#06B6D4', pipeline_id, profile_id),
      ('Perdido', 8, '#EF4444', pipeline_id, profile_id);
  END IF;
  
  RETURN NEW;
END;
$$;