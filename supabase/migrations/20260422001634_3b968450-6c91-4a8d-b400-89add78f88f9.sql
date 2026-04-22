CREATE OR REPLACE FUNCTION public.update_lead_rpc(
  p_clerk_user_id text,
  p_lead_id uuid,
  p_data json
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_id uuid;
  v_lead_org uuid;
  v_lead_seller uuid;
  v_lead_creator uuid;
  v_member_role text;
  v_lead json;
BEGIN
  SELECT id INTO v_profile_id
  FROM profiles
  WHERE clerk_user_id = p_clerk_user_id
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: profile not found';
  END IF;

  SELECT organization_id, seller_id, created_by
    INTO v_lead_org, v_lead_seller, v_lead_creator
  FROM leads
  WHERE id = p_lead_id
  LIMIT 1;

  IF v_lead_org IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  SELECT role INTO v_member_role
  FROM org_members
  WHERE clerk_user_id = p_clerk_user_id
    AND organization_id = v_lead_org
    AND status = 'active'
  LIMIT 1;

  IF v_member_role IS NULL THEN
    RAISE EXCEPTION 'Forbidden: not a member of this organization';
  END IF;

  IF v_member_role <> 'admin' THEN
    IF v_lead_seller IS DISTINCT FROM v_profile_id
       AND v_lead_creator IS DISTINCT FROM v_profile_id THEN
      RAISE EXCEPTION 'Forbidden: not authorized to update this lead';
    END IF;
  END IF;

  UPDATE leads SET
    name = COALESCE(p_data->>'name', name),
    phone = COALESCE(p_data->>'phone', phone),
    email = COALESCE(p_data->>'email', email),
    source = COALESCE(p_data->>'source', source),
    interest = COALESCE(p_data->>'interest', interest),
    observations = COALESCE(p_data->>'observations', observations),
    servico = COALESCE(p_data->>'servico', servico),
    cidade = COALESCE(p_data->>'cidade', cidade),
    estado = COALESCE(p_data->>'estado', estado),
    seller_id = COALESCE((p_data->>'seller_id')::uuid, seller_id),
    stage_id = COALESCE((p_data->>'stage_id')::uuid, stage_id),
    valor_negocio = COALESCE((p_data->>'valor_negocio')::numeric, valor_negocio),
    price = COALESCE(p_data->>'price', price)
  WHERE id = p_lead_id AND organization_id = v_lead_org
  RETURNING row_to_json(leads.*) INTO v_lead;

  RETURN v_lead;
END;
$function$;