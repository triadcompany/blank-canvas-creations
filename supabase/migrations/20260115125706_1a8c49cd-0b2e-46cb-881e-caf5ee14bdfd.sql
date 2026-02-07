-- Fix invited_by to store profile_id and allow seller role

-- 1) Expand role check constraint to include CRM roles
ALTER TABLE public.user_invitations
  DROP CONSTRAINT IF EXISTS user_invitations_role_check;

ALTER TABLE public.user_invitations
  ADD CONSTRAINT user_invitations_role_check
  CHECK (
    role = ANY (ARRAY[
      'admin'::text,
      'seller'::text,
      'medico'::text,
      'recepcionista'::text
    ])
  );

-- 2) Backfill invited_by values that currently store auth.user_id into profile_id
UPDATE public.user_invitations ui
SET invited_by = p.id
FROM public.profiles p
WHERE ui.invited_by = p.user_id
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p2 WHERE p2.id = ui.invited_by
  );

-- 3) Update RPC to insert profile_id into invited_by
CREATE OR REPLACE FUNCTION public.create_user_in_organization(p_email text, p_name text, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id uuid;
  v_user_id uuid;
  v_profile_id uuid;
  v_invitation_id uuid;
  v_existing_invitation user_invitations%ROWTYPE;
  v_existing_user record;
BEGIN
  -- Current authenticated user
  v_user_id := auth.uid();

  -- Fetch inviter profile + org
  SELECT id, organization_id
    INTO v_profile_id, v_organization_id
  FROM public.profiles
  WHERE user_id = v_user_id;

  IF v_organization_id IS NULL OR v_profile_id IS NULL THEN
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

  -- Check for pending invitation
  SELECT * INTO v_existing_invitation
  FROM public.user_invitations
  WHERE email = p_email
    AND organization_id = v_organization_id
    AND status = 'pending';

  IF v_existing_invitation.id IS NOT NULL THEN
    UPDATE public.user_invitations
    SET
      name = p_name,
      role = p_role,
      updated_at = now()
    WHERE id = v_existing_invitation.id;

    RETURN jsonb_build_object(
      'success', true,
      'invitation_id', v_existing_invitation.id,
      'message', 'Convite atualizado'
    );
  END IF;

  -- Create invitation storing profile_id in invited_by (FK -> profiles.id)
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
    p_role,
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
$function$;