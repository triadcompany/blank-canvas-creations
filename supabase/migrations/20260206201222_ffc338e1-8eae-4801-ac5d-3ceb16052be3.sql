
-- Drop temporary permissive policies
DROP POLICY IF EXISTS "Allow all for now" ON public.organizations;
DROP POLICY IF EXISTS "Allow all for now" ON public.profiles;
DROP POLICY IF EXISTS "Allow all for now" ON public.user_roles;

-- Create security definer function to get user's organization_id (avoids recursion)
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id 
  FROM public.profiles 
  WHERE clerk_user_id = auth.jwt() ->> 'sub'
  LIMIT 1
$$;

-- Create security definer function to check user role
CREATE OR REPLACE FUNCTION public.has_role(_clerk_user_id TEXT, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE clerk_user_id = _clerk_user_id
      AND role = _role
  )
$$;

-- Organizations policies: members can view their org, service role can insert
CREATE POLICY "Users can view their organization"
ON public.organizations FOR SELECT
TO authenticated
USING (id = public.get_user_organization_id());

CREATE POLICY "Service role can manage organizations"
ON public.organizations FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Allow anon to insert for provisioning (edge function uses service role but just in case)
CREATE POLICY "Allow insert for provisioning"
ON public.organizations FOR INSERT
TO anon
WITH CHECK (true);

-- Profiles policies
CREATE POLICY "Users can view profiles in their organization"
ON public.profiles FOR SELECT
TO authenticated
USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (clerk_user_id = auth.jwt() ->> 'sub')
WITH CHECK (clerk_user_id = auth.jwt() ->> 'sub');

CREATE POLICY "Service role can manage profiles"
ON public.profiles FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow insert for provisioning"
ON public.profiles FOR INSERT
TO anon
WITH CHECK (true);

-- User roles policies
CREATE POLICY "Users can view roles in their organization"
ON public.user_roles FOR SELECT
TO authenticated
USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Service role can manage roles"
ON public.user_roles FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow insert for provisioning"
ON public.user_roles FOR INSERT
TO anon
WITH CHECK (true);
