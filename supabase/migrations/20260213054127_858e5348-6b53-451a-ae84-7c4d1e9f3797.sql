
DROP FUNCTION IF EXISTS public.get_org_lead_sources(uuid);

CREATE OR REPLACE FUNCTION public.get_org_lead_sources(p_org_id uuid)
RETURNS TABLE(id uuid, name text, sort_order int, is_active boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ls.id, ls.name, ls.sort_order, ls.is_active
  FROM lead_sources ls
  WHERE ls.organization_id = p_org_id
    AND ls.is_active = true
  ORDER BY ls.sort_order, ls.name;
$$;
