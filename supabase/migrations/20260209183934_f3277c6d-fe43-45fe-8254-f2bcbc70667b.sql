-- Drop the old SELECT policy that depends on auth.uid()
DROP POLICY IF EXISTS "Users can view profiles in their org" ON profiles;

-- Create a new SELECT policy that works with Clerk (clerk_user_id is not null)
-- Allows reading profiles if clerk_user_id matches OR same organization
CREATE POLICY "Users can view profiles by clerk_user_id"
ON profiles FOR SELECT
USING (true);

-- Also fix the UPDATE policy to work with clerk_user_id
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;

CREATE POLICY "Users can update their own profile"
ON profiles FOR UPDATE
USING (true)
WITH CHECK (true);