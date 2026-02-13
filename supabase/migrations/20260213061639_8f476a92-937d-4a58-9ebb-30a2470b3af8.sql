
-- Drop existing leads policies that use authenticated role
DROP POLICY IF EXISTS "Org members can select leads" ON public.leads;
DROP POLICY IF EXISTS "Org members can insert leads" ON public.leads;
DROP POLICY IF EXISTS "Org members can update leads" ON public.leads;
DROP POLICY IF EXISTS "Org members can delete leads" ON public.leads;

-- Recreate get_my_org_id to work without auth.jwt() 
-- It now checks BOTH auth.jwt() (for service_role/authenticated) AND 
-- falls back to checking profiles table via request headers
CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id 
  FROM public.profiles 
  WHERE clerk_user_id = COALESCE(
    auth.jwt() ->> 'sub',
    current_setting('request.header.x-clerk-user-id', true)
  )
  LIMIT 1;
$$;

-- Recreate get_my_role similarly
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.org_members
  WHERE clerk_user_id = COALESCE(
    auth.jwt() ->> 'sub',
    current_setting('request.header.x-clerk-user-id', true)
  )
  LIMIT 1;
$$;

-- Recreate leads policies for anon role (since Clerk users connect as anon)
CREATE POLICY "Org members can select leads"
ON public.leads FOR SELECT
TO anon, authenticated
USING (organization_id = get_my_org_id());

CREATE POLICY "Org members can insert leads"
ON public.leads FOR INSERT
TO anon, authenticated
WITH CHECK (organization_id = get_my_org_id());

CREATE POLICY "Org members can update leads"
ON public.leads FOR UPDATE
TO anon, authenticated
USING (organization_id = get_my_org_id())
WITH CHECK (organization_id = get_my_org_id());

CREATE POLICY "Org members can delete leads"
ON public.leads FOR DELETE
TO anon, authenticated
USING (organization_id = get_my_org_id());
