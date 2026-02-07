-- Corrigir a função para permitir recriar usuários após exclusão
-- Remover convites aceitos de usuários que foram deletados

-- Limpar convites de usuários que não existem mais no auth
DELETE FROM user_invitations 
WHERE status = 'accepted' 
AND email NOT IN (SELECT email FROM auth.users);

-- Atualizar a função para verificar apenas usuários ativos
CREATE OR REPLACE FUNCTION public.create_user_in_organization(p_email text, p_name text, p_role app_role DEFAULT 'seller'::app_role, p_temp_password text DEFAULT 'temppass123'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  org_id uuid;
  result json;
  existing_user uuid;
  existing_invitation uuid;
BEGIN
  -- Verificar se o usuário atual é admin
  SELECT organization_id INTO org_id
  FROM profiles 
  WHERE user_id = auth.uid() AND role = 'admin';
  
  IF org_id IS NULL THEN
    RETURN json_build_object('error', 'Apenas administradores podem criar usuários');
  END IF;
  
  -- Verificar se já existe usuário ATIVO com este email (apenas em auth.users)
  SELECT id INTO existing_user 
  FROM auth.users 
  WHERE email = p_email;
  
  IF existing_user IS NOT NULL THEN
    RETURN json_build_object('error', 'Usuário já existe com este email');
  END IF;
  
  -- Limpar qualquer convite anterior deste email
  DELETE FROM user_invitations 
  WHERE email = p_email;
  
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
$function$

-- Também atualizar a função de convite para limpar convites antigos
CREATE OR REPLACE FUNCTION public.invite_user_to_organization(inviter_user_id uuid, invite_email text, invite_name text, invite_role app_role DEFAULT 'seller'::app_role)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  org_id uuid;
  inviter_profile_id uuid;
  existing_user uuid;
  existing_invitation uuid;
  result json;
BEGIN
  -- Check if inviter is admin and get their profile info
  SELECT organization_id, id INTO org_id, inviter_profile_id
  FROM profiles 
  WHERE user_id = inviter_user_id AND role = 'admin';
  
  IF org_id IS NULL THEN
    RETURN json_build_object('error', 'Only admins can invite users');
  END IF;
  
  -- Check if user already exists in auth (apenas usuários ativos)
  SELECT id INTO existing_user 
  FROM auth.users 
  WHERE email = invite_email;
  
  IF existing_user IS NOT NULL THEN
    RETURN json_build_object('error', 'User already exists');
  END IF;
  
  -- Limpar convites antigos deste email antes de criar novo
  DELETE FROM user_invitations
  WHERE email = invite_email;
  
  -- Create invitation record
  INSERT INTO user_invitations (
    organization_id,
    email,
    name,
    role,
    invited_by,
    status
  ) VALUES (
    org_id,
    invite_email,
    invite_name,
    invite_role,
    inviter_profile_id,
    'pending'
  );
  
  RETURN json_build_object(
    'success', true, 
    'message', 'Invitation created successfully',
    'organization_id', org_id
  );
END;
$function$