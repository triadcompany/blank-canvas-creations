
-- Create RPC for inserting leads (bypasses RLS via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.create_lead_rpc(
  p_clerk_user_id text,
  p_name text,
  p_phone text,
  p_email text DEFAULT '',
  p_source text DEFAULT '',
  p_interest text DEFAULT '',
  p_price text DEFAULT '',
  p_observations text DEFAULT '',
  p_servico text DEFAULT '',
  p_cidade text DEFAULT '',
  p_estado text DEFAULT '',
  p_seller_id uuid DEFAULT NULL,
  p_stage_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_org_id uuid;
  v_final_seller_id uuid;
  v_lead json;
BEGIN
  -- Resolve clerk user to profile
  SELECT id, organization_id INTO v_profile_id, v_org_id
  FROM profiles
  WHERE clerk_user_id = p_clerk_user_id
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found for clerk user %', p_clerk_user_id;
  END IF;

  v_final_seller_id := COALESCE(p_seller_id, v_profile_id);

  INSERT INTO leads (
    name, phone, email, source, interest, price, observations,
    servico, cidade, estado,
    seller_id, created_by, stage_id, organization_id
  ) VALUES (
    p_name, p_phone, 
    NULLIF(p_email, ''), NULLIF(p_source, ''), NULLIF(p_interest, ''),
    NULLIF(p_price, ''), NULLIF(p_observations, ''),
    NULLIF(p_servico, ''), NULLIF(p_cidade, ''), NULLIF(p_estado, ''),
    v_final_seller_id, v_profile_id, p_stage_id, v_org_id
  )
  RETURNING row_to_json(leads.*) INTO v_lead;

  RETURN v_lead;
END;
$$;

-- Create RPC for fetching leads (bypasses RLS via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.get_org_leads(
  p_clerk_user_id text,
  p_org_id uuid,
  p_is_admin boolean DEFAULT false,
  p_seller_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_org_id uuid;
  v_result json;
BEGIN
  -- Validate user belongs to org
  SELECT id, organization_id INTO v_profile_id, v_org_id
  FROM profiles
  WHERE clerk_user_id = p_clerk_user_id AND organization_id = p_org_id
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  IF p_is_admin THEN
    SELECT json_agg(row_to_json(t)) INTO v_result
    FROM (
      SELECT l.*,
        p.name as seller_name,
        ps.name as stage_name,
        ps.position as stage_position,
        ps.color as stage_color
      FROM leads l
      LEFT JOIN profiles p ON p.id = l.seller_id
      LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
      WHERE l.organization_id = p_org_id
      ORDER BY l.created_at DESC
    ) t;
  ELSE
    SELECT json_agg(row_to_json(t)) INTO v_result
    FROM (
      SELECT l.*,
        p.name as seller_name,
        ps.name as stage_name,
        ps.position as stage_position,
        ps.color as stage_color
      FROM leads l
      LEFT JOIN profiles p ON p.id = l.seller_id
      LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
      WHERE l.organization_id = p_org_id
        AND l.seller_id = COALESCE(p_seller_id, v_profile_id)
      ORDER BY l.created_at DESC
    ) t;
  END IF;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- Create RPC for updating leads
CREATE OR REPLACE FUNCTION public.update_lead_rpc(
  p_clerk_user_id text,
  p_lead_id uuid,
  p_data json
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Only update leads from same org
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
    stage_id = COALESCE((p_data->>'stage_id')::uuid, stage_id)
  WHERE id = p_lead_id AND organization_id = v_org_id
  RETURNING row_to_json(leads.*) INTO v_lead;

  RETURN v_lead;
END;
$$;

-- Create RPC for deleting leads
CREATE OR REPLACE FUNCTION public.delete_lead_rpc(
  p_clerk_user_id text,
  p_lead_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM profiles WHERE clerk_user_id = p_clerk_user_id LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  DELETE FROM leads WHERE id = p_lead_id AND organization_id = v_org_id;
  RETURN FOUND;
END;
$$;
