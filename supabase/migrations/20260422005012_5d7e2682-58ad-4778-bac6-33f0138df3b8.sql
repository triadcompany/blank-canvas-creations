CREATE OR REPLACE FUNCTION public.update_user_role_rpc(p_caller_clerk_user_id text, p_target_clerk_user_id text, p_organization_id uuid, p_new_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role text;
  v_target_clerk_org_id text;
  v_admin_count int;
  v_creator_clerk_user_id text;
BEGIN
  IF p_new_role NOT IN ('admin', 'seller') THEN
    RAISE EXCEPTION 'Papel inválido: %', p_new_role;
  END IF;

  SELECT role INTO v_caller_role
  FROM public.org_members
  WHERE clerk_user_id = p_caller_clerk_user_id
    AND organization_id = p_organization_id;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Você não é membro desta organização';
  END IF;

  IF v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar papéis';
  END IF;

  SELECT clerk_org_id INTO v_target_clerk_org_id
  FROM public.org_members
  WHERE clerk_user_id = p_target_clerk_user_id
    AND organization_id = p_organization_id
  LIMIT 1;

  IF v_target_clerk_org_id IS NULL THEN
    RAISE EXCEPTION 'Usuário alvo não pertence a esta organização';
  END IF;

  -- Proteção: o criador da organização nunca pode ser rebaixado a vendedor
  IF p_new_role = 'seller' THEN
    SELECT co.created_by_clerk_user_id INTO v_creator_clerk_user_id
    FROM public.clerk_organizations co
    WHERE co.clerk_org_id = v_target_clerk_org_id
    LIMIT 1;

    IF v_creator_clerk_user_id IS NOT NULL
       AND v_creator_clerk_user_id = p_target_clerk_user_id THEN
      RAISE EXCEPTION 'O criador da organização não pode ser rebaixado a vendedor';
    END IF;

    SELECT COUNT(*) INTO v_admin_count
    FROM public.org_members
    WHERE organization_id = p_organization_id
      AND role = 'admin'
      AND clerk_user_id <> p_target_clerk_user_id;

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'A organização precisa ter pelo menos um administrador';
    END IF;
  END IF;

  UPDATE public.org_members
  SET role = p_new_role,
      updated_at = now()
  WHERE clerk_user_id = p_target_clerk_user_id
    AND organization_id = p_organization_id;

  UPDATE public.user_roles
  SET role = p_new_role::app_role
  WHERE clerk_user_id = p_target_clerk_user_id
    AND organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'success', true,
    'clerk_user_id', p_target_clerk_user_id,
    'clerk_org_id', v_target_clerk_org_id,
    'new_role', p_new_role,
    'is_creator', (v_creator_clerk_user_id = p_target_clerk_user_id)
  );
END;
$function$;