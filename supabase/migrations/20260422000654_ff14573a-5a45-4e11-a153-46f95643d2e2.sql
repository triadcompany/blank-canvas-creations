-- Fix get_org_leads to validate membership via org_members (not profiles.organization_id)
-- This ensures users see leads in the active org even when their profile.organization_id is stale

CREATE OR REPLACE FUNCTION public.get_org_leads(
  p_clerk_user_id text,
  p_org_id uuid,
  p_is_admin boolean DEFAULT false,
  p_seller_id uuid DEFAULT NULL::uuid
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_id uuid;
  v_is_member boolean;
  v_result json;
  v_effective_seller_id uuid;
BEGIN
  -- Resolve user's profile id (regardless of stale profile.organization_id)
  SELECT id INTO v_profile_id
  FROM profiles
  WHERE clerk_user_id = p_clerk_user_id
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  -- Validate active membership in the requested org
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE clerk_user_id = p_clerk_user_id
      AND organization_id = p_org_id
      AND status = 'active'
  ) INTO v_is_member;

  IF NOT v_is_member THEN
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
    -- Sellers see leads where they are seller OR creator (own leads)
    v_effective_seller_id := COALESCE(p_seller_id, v_profile_id);

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
        AND (l.seller_id = v_effective_seller_id OR l.created_by = v_effective_seller_id)
      ORDER BY l.created_at DESC
    ) t;
  END IF;

  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;