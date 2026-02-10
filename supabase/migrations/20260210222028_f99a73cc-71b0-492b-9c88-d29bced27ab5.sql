
-- Fix FK: conversations.assigned_to should reference profiles.id, not auth.users.id
-- This is needed because the system uses Clerk auth and profiles.id is the internal UUID
ALTER TABLE public.conversations DROP CONSTRAINT conversations_assigned_to_fkey;

ALTER TABLE public.conversations 
  ADD CONSTRAINT conversations_assigned_to_fkey 
  FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL;
