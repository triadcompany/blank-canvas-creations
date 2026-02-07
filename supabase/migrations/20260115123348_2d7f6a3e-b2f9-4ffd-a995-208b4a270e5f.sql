
-- Fix foreign key constraint: invited_by should reference profiles.id, not auth.users.id
ALTER TABLE public.user_invitations
  DROP CONSTRAINT user_invitations_invited_by_fkey;

ALTER TABLE public.user_invitations
  ADD CONSTRAINT user_invitations_invited_by_fkey
  FOREIGN KEY (invited_by)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL;
