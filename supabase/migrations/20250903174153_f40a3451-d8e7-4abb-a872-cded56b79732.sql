-- Criar função para cadastrar usuário diretamente na organização
CREATE OR REPLACE FUNCTION public.create_user_in_organization(
  p_email text,
  p_name text,
  p_role app_role DEFAULT 'seller'::app_role,
  p_temp_password text DEFAULT 'temppass123'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  org_id uuid;
  result json;
  existing_user uuid;
BEGIN
  -- Verificar se o usuário atual é admin
  SELECT organization_id INTO org_id
  FROM profiles 
  WHERE user_id = auth.uid() AND role = 'admin';
  
  IF org_id IS NULL THEN
    RETURN json_build_object('error', 'Apenas administradores podem criar usuários');
  END IF;
  
  -- Verificar se já existe usuário com este email
  SELECT user_id INTO existing_user 
  FROM profiles 
  WHERE email = p_email;
  
  IF existing_user IS NOT NULL THEN
    RETURN json_build_object('error', 'Usuário já existe com este email');
  END IF;
  
  -- Criar convite com status especial para criação direta
  INSERT INTO user_invitations (
    organization_id,
    email,
    name,
    role,
    invited_by,
    status
  ) VALUES (
    org_id,
    p_email,
    p_name,
    p_role,
    (SELECT id FROM profiles WHERE user_id = auth.uid()),
    'direct_creation'
  );
  
  RETURN json_build_object(
    'success', true, 
    'message', 'Usuário pode agora se cadastrar no sistema',
    'organization_id', org_id,
    'email', p_email,
    'name', p_name,
    'role', p_role
  );
END;
$$;