
-- RPC to fetch conversations for the inbox, bypassing RLS header issues
CREATE OR REPLACE FUNCTION public.get_org_conversations(
  p_clerk_user_id text,
  p_org_id uuid,
  p_is_admin boolean DEFAULT false,
  p_seller_id uuid DEFAULT NULL,
  p_filter text DEFAULT 'all',
  p_search text DEFAULT '',
  p_limit int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Verify the user belongs to the org
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
      -- Filter logic
      AND (
        CASE p_filter
          WHEN 'mine' THEN c.assigned_to = p_seller_id
          WHEN 'unassigned' THEN c.assigned_to IS NULL
          WHEN 'open' THEN c.status = 'open'
          WHEN 'in_progress' THEN c.status = 'in_progress'
          WHEN 'waiting_customer' THEN c.status = 'waiting_customer'
          WHEN 'closed' THEN c.status = 'closed'
          ELSE true -- 'all'
        END
      )
      -- Seller visibility: only their own + unassigned (unless admin)
      AND (
        p_is_admin
        OR p_filter = 'mine'
        OR c.assigned_to = p_seller_id
        OR c.assigned_to IS NULL
      )
      -- Search
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
      ps.name AS lead_stage_name
    FROM filtered_convs fc
    LEFT JOIN leads l ON l.id = fc.lead_id
    LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
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
$$;

-- RPC to fetch messages for a conversation
CREATE OR REPLACE FUNCTION public.get_conversation_messages(
  p_clerk_user_id text,
  p_org_id uuid,
  p_conversation_id uuid,
  p_limit int DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Verify user belongs to org
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE clerk_user_id = p_clerk_user_id
      AND organization_id = p_org_id
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Verify conversation belongs to org
  IF NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE id = p_conversation_id
      AND organization_id = p_org_id
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'organization_id', m.organization_id,
      'conversation_id', m.conversation_id,
      'direction', m.direction,
      'body', m.body,
      'external_message_id', m.external_message_id,
      'created_at', m.created_at,
      'ai_generated', m.ai_generated,
      'ai_interaction_id', m.ai_interaction_id,
      'message_type', m.message_type,
      'media_url', m.media_url,
      'mime_type', m.mime_type,
      'duration_ms', m.duration_ms
    ) ORDER BY m.created_at ASC
  ), '[]'::jsonb) INTO result
  FROM messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.organization_id = p_org_id
  LIMIT p_limit;

  RETURN result;
END;
$$;

-- RPC to update conversation fields (status, assigned_to, locked_by, unread_count, etc.)
CREATE OR REPLACE FUNCTION public.update_conversation(
  p_clerk_user_id text,
  p_org_id uuid,
  p_conversation_id uuid,
  p_updates jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify user belongs to org
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE clerk_user_id = p_clerk_user_id
      AND organization_id = p_org_id
  ) THEN
    RETURN false;
  END IF;

  UPDATE conversations
  SET
    assigned_to = COALESCE((p_updates->>'assigned_to')::uuid, assigned_to),
    assigned_at = CASE WHEN p_updates ? 'assigned_at' THEN (p_updates->>'assigned_at')::timestamptz ELSE assigned_at END,
    status = COALESCE(p_updates->>'status', status),
    locked_by = CASE WHEN p_updates ? 'locked_by' THEN (p_updates->>'locked_by')::uuid ELSE locked_by END,
    locked_at = CASE WHEN p_updates ? 'locked_at' THEN (p_updates->>'locked_at')::timestamptz ELSE locked_at END,
    last_status_change_at = CASE WHEN p_updates ? 'last_status_change_at' THEN (p_updates->>'last_status_change_at')::timestamptz ELSE last_status_change_at END,
    unread_count = CASE WHEN p_updates ? 'unread_count' THEN (p_updates->>'unread_count')::int ELSE unread_count END,
    ai_mode = COALESCE(p_updates->>'ai_mode', ai_mode),
    ai_state = CASE WHEN p_updates ? 'ai_state' THEN p_updates->>'ai_state' ELSE ai_state END
  WHERE id = p_conversation_id
    AND organization_id = p_org_id;

  RETURN true;
END;
$$;

-- RPC to insert conversation events
CREATE OR REPLACE FUNCTION public.insert_conversation_event(
  p_clerk_user_id text,
  p_org_id uuid,
  p_conversation_id uuid,
  p_event_type text,
  p_metadata jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  SELECT id INTO v_profile_id
  FROM profiles
  WHERE clerk_user_id = p_clerk_user_id
    AND organization_id = p_org_id;

  IF v_profile_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO conversation_events (organization_id, conversation_id, event_type, performed_by, metadata)
  VALUES (p_org_id, p_conversation_id, p_event_type, v_profile_id, p_metadata);

  RETURN true;
END;
$$;
