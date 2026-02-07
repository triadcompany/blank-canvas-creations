-- Atualizar a função de convite para limpar convites antigos
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
$function$;