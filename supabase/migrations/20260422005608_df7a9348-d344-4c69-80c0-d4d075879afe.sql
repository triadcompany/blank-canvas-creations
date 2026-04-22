CREATE OR REPLACE FUNCTION public.get_org_sales_stage_ids(p_org_id uuid)
RETURNS TABLE(stage_id uuid, stage_name text, pipeline_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT ps.id AS stage_id, ps.name AS stage_name, ps.pipeline_id
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id
  WHERE p.organization_id = p_org_id
    AND ps.is_active = true
    AND p.is_active = true
    AND (
      LOWER(ps.name) LIKE '%venda%'
      OR LOWER(ps.name) LIKE '%vendido%'
      OR LOWER(ps.name) LIKE '%fechado%'
      OR LOWER(ps.name) LIKE '%ganho%'
      OR LOWER(ps.name) LIKE '%won%'
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_org_sales_stage_ids(uuid) TO anon, authenticated, service_role;