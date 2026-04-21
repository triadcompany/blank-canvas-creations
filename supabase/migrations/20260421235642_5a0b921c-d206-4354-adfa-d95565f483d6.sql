
CREATE OR REPLACE FUNCTION public.create_lead_rpc(
  p_clerk_user_id text,
  p_name text,
  p_phone text,
  p_email text DEFAULT ''::text,
  p_source text DEFAULT ''::text,
  p_interest text DEFAULT ''::text,
  p_price text DEFAULT ''::text,
  p_observations text DEFAULT ''::text,
  p_servico text DEFAULT ''::text,
  p_cidade text DEFAULT ''::text,
  p_estado text DEFAULT ''::text,
  p_seller_id uuid DEFAULT NULL::uuid,
  p_stage_id uuid DEFAULT NULL::uuid,
  p_org_id uuid DEFAULT NULL::uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_id uuid;
  v_org_id uuid;
  v_final_seller_id uuid;
  v_lead json;
  v_member_role text;
BEGIN
  -- Resolve clerk user to profile (used for created_by/seller fallback)
  SELECT id, organization_id INTO v_profile_id, v_org_id
  FROM profiles
  WHERE clerk_user_id = p_clerk_user_id
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found for clerk user %', p_clerk_user_id;
  END IF;

  -- If caller provided an explicit org, verify membership and prefer it.
  IF p_org_id IS NOT NULL THEN
    SELECT role INTO v_member_role
    FROM org_members
    WHERE clerk_user_id = p_clerk_user_id
      AND organization_id = p_org_id
      AND status = 'active'
    LIMIT 1;

    IF v_member_role IS NULL THEN
      RAISE EXCEPTION 'User is not an active member of organization %', p_org_id;
    END IF;

    v_org_id := p_org_id;
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
$function$;
