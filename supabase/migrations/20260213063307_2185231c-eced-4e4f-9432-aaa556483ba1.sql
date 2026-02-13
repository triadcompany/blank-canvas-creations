CREATE OR REPLACE FUNCTION public.update_lead_rpc(
  p_clerk_user_id text,
  p_lead_id uuid,
  p_data json
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile_id uuid;
  v_org_id uuid;
  v_lead json;
BEGIN
  SELECT id, organization_id INTO v_profile_id, v_org_id
  FROM profiles WHERE clerk_user_id = p_clerk_user_id LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
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
  WHERE id = p_lead_id AND organization_id = v_org_id
  RETURNING row_to_json(leads.*) INTO v_lead;

  RETURN v_lead;
END;
$$;