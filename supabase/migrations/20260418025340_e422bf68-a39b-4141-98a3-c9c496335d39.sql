-- Fix user_invitations FK: pointing to clerk_organizations (canonical orgs table for Clerk-managed tenants)
ALTER TABLE public.user_invitations DROP CONSTRAINT IF EXISTS user_invitations_organization_id_fkey;
ALTER TABLE public.user_invitations 
  ADD CONSTRAINT user_invitations_organization_id_fkey 
  FOREIGN KEY (organization_id) REFERENCES public.clerk_organizations(id) ON DELETE CASCADE;