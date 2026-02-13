
-- Create RPC to fetch lead sources by org (bypasses RLS for Clerk-based auth)
CREATE OR REPLACE FUNCTION public.get_org_lead_sources(p_org_id uuid)
RETURNS SETOF lead_sources
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT * FROM lead_sources
  WHERE organization_id = p_org_id AND is_active = true
  ORDER BY sort_order ASC, name ASC;
$$;
