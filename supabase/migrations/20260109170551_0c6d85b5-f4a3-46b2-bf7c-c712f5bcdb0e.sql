-- Fix FK: n8n_workflows.organization_id should reference public.organizations, not public.saas_organizations

ALTER TABLE public.n8n_workflows
  DROP CONSTRAINT IF EXISTS n8n_workflows_organization_id_fkey;

ALTER TABLE public.n8n_workflows
  ADD CONSTRAINT n8n_workflows_organization_id_fkey
  FOREIGN KEY (organization_id)
  REFERENCES public.organizations(id)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

-- Helpful index for lookups by org
CREATE INDEX IF NOT EXISTS idx_n8n_workflows_organization_id
  ON public.n8n_workflows(organization_id);
