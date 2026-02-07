-- Fix infinite recursion: get_user_organization_id() must not query public.users (it triggers users RLS policies)
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT organization_id
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

-- Remove legacy policies on n8n_workflows that depended on public.users
DROP POLICY IF EXISTS "Organization members can manage n8n workflows" ON public.n8n_workflows;
DROP POLICY IF EXISTS "Organization members can read n8n workflows" ON public.n8n_workflows;
DROP POLICY IF EXISTS "Dev: acesso total n8n_workflows" ON public.n8n_workflows;