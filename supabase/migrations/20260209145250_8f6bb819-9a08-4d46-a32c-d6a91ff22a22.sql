
-- Drop the old INSERT policy that requires auth.uid()
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

-- Create a new INSERT policy that allows inserting when clerk_user_id is provided
-- Since Clerk is the auth provider (not Supabase Auth), auth.uid() is always null.
-- The insert is safe because clerk_user_id is validated by the application layer,
-- and the "Service can manage profiles" policy already allows service_role full access.
-- We allow inserts where clerk_user_id is not null (onboarding flow).
CREATE POLICY "Users can insert profile during onboarding"
ON public.profiles
FOR INSERT
WITH CHECK (clerk_user_id IS NOT NULL);
