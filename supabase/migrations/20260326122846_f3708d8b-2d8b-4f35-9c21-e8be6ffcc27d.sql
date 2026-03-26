CREATE OR REPLACE FUNCTION public.get_org_conversations(
  p_clerk_user_id text,
  p_org_id uuid,
  p_is_admin boolean DEFAULT false,
  p_seller_id uuid DEFAULT NULL::uuid,
  p_filter text DEFAULT 'all'::text,
  p_search text DEFAULT ''::text,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE clerk_user_id = p_clerk_user_id
      AND organization_id = p_org_id
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH filtered_convs AS (
    SELECT c.*
    FROM conversations c
    WHERE c.organization_id = p_org_id
      AND (
        CASE p_filter
          WHEN 'mine' THEN c.assigned_to = p_seller_id
          WHEN 'unassigned' THEN c.assigned_to IS NULL
          WHEN 'open' THEN c.status = 'open'
          WHEN 'in_progress' THEN c.status = 'in_progress'
          WHEN 'waiting_customer' THEN c.status = 'waiting_customer'
          WHEN 'closed' THEN c.status = 'closed'
          WHEN 'meta_ads' THEN c.lead_id IS NOT NULL
          ELSE true
        END
      )
      AND (
        p_is_admin
        OR p_filter = 'mine'
        OR c.assigned_to = p_seller_id
        OR c.assigned_to IS NULL
      )
      AND (
        p_search = ''
        OR c.contact_phone ILIKE '%' || p_search || '%'
        OR c.contact_name ILIKE '%' || p_search || '%'
      )
    ORDER BY c.last_message_at DESC NULLS LAST
    LIMIT p_limit
  ),
  convs_with_leads AS (
    SELECT
      fc.*,
      l.id AS lead_id_resolved,
      ps.name AS lead_stage_name,
      COALESCE(ls.name, l.source) AS lead_source_name
    FROM filtered_convs fc
    LEFT JOIN leads l ON l.id = fc.lead_id
    LEFT JOIN lead_sources ls ON ls.id = l.lead_source_id
    LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
    WHERE (
      CASE
        WHEN p_filter = 'meta_ads' THEN regexp_replace(lower(COALESCE(ls.name, l.source, '')), '\s+', '', 'g') = 'metaads'
        ELSE true
      END
    )
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', cwl.id,
      'organization_id', cwl.organization_id,
      'instance_name', cwl.instance_name,
      'contact_phone', cwl.contact_phone,
      'contact_name', cwl.contact_name,
      'contact_name_source', cwl.contact_name_source,
      'assigned_to', cwl.assigned_to,
      'assigned_at', cwl.assigned_at,
      'last_message_at', cwl.last_message_at,
      'last_message_preview', cwl.last_message_preview,
      'unread_count', cwl.unread_count,
      'created_at', cwl.created_at,
      'profile_picture_url', cwl.profile_picture_url,
      'profile_picture_updated_at', cwl.profile_picture_updated_at,
      'lead_id', cwl.lead_id,
      'lead_stage_name', cwl.lead_stage_name,
      'lead_source', cwl.lead_source_name,
      'ai_mode', cwl.ai_mode,
      'ai_state', cwl.ai_state,
      'last_ai_reply_at', cwl.last_ai_reply_at,
      'ai_reply_count_since_last_lead', cwl.ai_reply_count_since_last_lead,
      'ai_pending', cwl.ai_pending,
      'ai_pending_started_at', cwl.ai_pending_started_at,
      'status', COALESCE(cwl.status, 'open'),
      'locked_by', cwl.locked_by,
      'locked_at', cwl.locked_at,
      'last_status_change_at', cwl.last_status_change_at,
      'channel', cwl.channel
    )
  ), '[]'::jsonb) INTO result
  FROM convs_with_leads cwl;

  RETURN result;
END;
$function$;