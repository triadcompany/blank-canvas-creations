-- Fix n8n_workflows policies: profiles PK is not auth.uid(); use profiles.user_id
DROP POLICY IF EXISTS "Allow users to view n8n_workflows" ON public.n8n_workflows;
DROP POLICY IF EXISTS "Allow users to insert n8n_workflows" ON public.n8n_workflows;
DROP POLICY IF EXISTS "Allow users to update n8n_workflows" ON public.n8n_workflows;
DROP POLICY IF EXISTS "Allow users to delete n8n_workflows" ON public.n8n_workflows;

CREATE POLICY "Allow users to view n8n_workflows" ON public.n8n_workflows
FOR SELECT
USING (
  organization_id IN (
    SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
  )
);

CREATE POLICY "Allow users to insert n8n_workflows" ON public.n8n_workflows
FOR INSERT
WITH CHECK (
  organization_id IN (
    SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
  )
);

CREATE POLICY "Allow users to update n8n_workflows" ON public.n8n_workflows
FOR UPDATE
USING (
  organization_id IN (
    SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
  )
)
WITH CHECK (
  organization_id IN (
    SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
  )
);

CREATE POLICY "Allow users to delete n8n_workflows" ON public.n8n_workflows
FOR DELETE
USING (
  organization_id IN (
    SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
  )
);