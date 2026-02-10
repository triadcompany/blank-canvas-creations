
-- Fix FK: automations.organization_id should reference organizations, not saas_organizations
ALTER TABLE public.automations DROP CONSTRAINT IF EXISTS automations_organization_id_fkey;
ALTER TABLE public.automations ADD CONSTRAINT automations_organization_id_fkey 
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id);

-- Same fix for automation_logs
ALTER TABLE public.automation_logs DROP CONSTRAINT IF EXISTS automation_logs_organization_id_fkey;
ALTER TABLE public.automation_logs ADD CONSTRAINT automation_logs_organization_id_fkey 
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
