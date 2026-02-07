
-- Create the RPC function for creating user invitations
CREATE OR REPLACE FUNCTION public.create_user_in_organization(
  p_email text,
  p_name text,
  p_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
  v_profile_id uuid;
  v_invitation_id uuid;
  v_existing_invitation user_invitations%ROWTYPE;
  v_existing_user record;
BEGIN
  -- Get the organization_id of the current user
  SELECT organization_id, id INTO v_organization_id, v_profile_id
  FROM public.profiles
  WHERE user_id = auth.uid();

  IF v_organization_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuário não pertence a nenhuma organização');
  END IF;

  -- Check if email already exists in auth.users
  SELECT id INTO v_existing_user
  FROM auth.users
  WHERE email = p_email;

  IF v_existing_user.id IS NOT NULL THEN
    -- Check if user is already in this organization
    IF EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE user_id = v_existing_user.id 
      AND organization_id = v_organization_id
    ) THEN
      RETURN jsonb_build_object('error', 'Este usuário já faz parte da sua organização');
    END IF;
  END IF;

  -- Check if there's already a pending invitation for this email
  SELECT * INTO v_existing_invitation
  FROM public.user_invitations
  WHERE email = p_email
    AND organization_id = v_organization_id
    AND status = 'pending';

  IF v_existing_invitation.id IS NOT NULL THEN
    -- Update the existing invitation
    UPDATE public.user_invitations
    SET 
      name = p_name,
      role = p_role::app_role,
      updated_at = now()
    WHERE id = v_existing_invitation.id;
    
    RETURN jsonb_build_object(
      'success', true,
      'invitation_id', v_existing_invitation.id,
      'message', 'Convite atualizado'
    );
  END IF;

  -- Create new invitation
  INSERT INTO public.user_invitations (
    organization_id,
    email,
    name,
    role,
    invited_by,
    status
  ) VALUES (
    v_organization_id,
    p_email,
    p_name,
    p_role::app_role,
    v_profile_id,
    'pending'
  )
  RETURNING id INTO v_invitation_id;

  RETURN jsonb_build_object(
    'success', true,
    'invitation_id', v_invitation_id,
    'organization_id', v_organization_id
  );
END;
$$;
