
-- Add lead_id support to update_conversation RPC
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
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE clerk_user_id = p_clerk_user_id
      AND organization_id = p_org_id
  ) THEN
    RETURN false;
  END IF;

  UPDATE conversations
  SET
    assigned_to = CASE WHEN p_updates ? 'assigned_to' THEN (p_updates->>'assigned_to')::uuid ELSE assigned_to END,
    assigned_at = CASE WHEN p_updates ? 'assigned_at' THEN (p_updates->>'assigned_at')::timestamptz ELSE assigned_at END,
    status = COALESCE(p_updates->>'status', status),
    locked_by = CASE WHEN p_updates ? 'locked_by' THEN (p_updates->>'locked_by')::uuid ELSE locked_by END,
    locked_at = CASE WHEN p_updates ? 'locked_at' THEN (p_updates->>'locked_at')::timestamptz ELSE locked_at END,
    last_status_change_at = CASE WHEN p_updates ? 'last_status_change_at' THEN (p_updates->>'last_status_change_at')::timestamptz ELSE last_status_change_at END,
    unread_count = CASE WHEN p_updates ? 'unread_count' THEN (p_updates->>'unread_count')::int ELSE unread_count END,
    ai_mode = COALESCE(p_updates->>'ai_mode', ai_mode),
    ai_state = CASE WHEN p_updates ? 'ai_state' THEN p_updates->>'ai_state' ELSE ai_state END,
    lead_id = CASE WHEN p_updates ? 'lead_id' THEN (p_updates->>'lead_id')::uuid ELSE lead_id END,
    ai_pending = CASE WHEN p_updates ? 'ai_pending' THEN (p_updates->>'ai_pending')::boolean ELSE ai_pending END,
    ai_pending_started_at = CASE WHEN p_updates ? 'ai_pending_started_at' THEN (p_updates->>'ai_pending_started_at')::timestamptz ELSE ai_pending_started_at END,
    ai_reply_count_since_last_lead = CASE WHEN p_updates ? 'ai_reply_count_since_last_lead' THEN (p_updates->>'ai_reply_count_since_last_lead')::int ELSE ai_reply_count_since_last_lead END
  WHERE id = p_conversation_id
    AND organization_id = p_org_id;

  RETURN true;
END;
$$;
