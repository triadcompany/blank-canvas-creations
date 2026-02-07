
-- Fix foreign key constraint: organization_id should reference organizations.id
ALTER TABLE public.user_invitations
  DROP CONSTRAINT IF EXISTS user_invitations_organization_id_fkey;

ALTER TABLE public.user_invitations
  ADD CONSTRAINT user_invitations_organization_id_fkey
  FOREIGN KEY (organization_id)
  REFERENCES public.organizations(id)
  ON DELETE CASCADE;
