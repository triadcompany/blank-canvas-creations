-- Allow authenticated/anon users to insert organizations during sync
-- This is needed because Clerk auth doesn't use Supabase auth, so requests come as anon
CREATE POLICY "Allow org creation during sync"
ON public.organizations
FOR INSERT
WITH CHECK (true);
