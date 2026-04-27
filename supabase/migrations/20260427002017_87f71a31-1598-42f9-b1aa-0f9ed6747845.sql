CREATE OR REPLACE FUNCTION public.get_inbox_contacts_for_broadcast(
  p_status text DEFAULT 'all',
  p_seller_id text DEFAULT 'all'
)
RETURNS TABLE (
  id uuid,
  contact_phone text,
  contact_name text,
  status text,
  assigned_to uuid,
  last_message_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  v_org := public.get_my_org_id();
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.id, c.contact_phone, c.contact_name, c.status, c.assigned_to, c.last_message_at
  FROM public.conversations c
  WHERE c.organization_id = v_org
    AND c.contact_phone IS NOT NULL
    AND c.contact_phone <> ''
    AND (p_status = 'all' OR c.status = p_status)
    AND (
      p_seller_id = 'all'
      OR (p_seller_id = 'none' AND c.assigned_to IS NULL)
      OR (p_seller_id NOT IN ('all','none') AND c.assigned_to = p_seller_id::uuid)
    )
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT 2000;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inbox_contacts_for_broadcast(text, text) TO anon, authenticated, service_role;