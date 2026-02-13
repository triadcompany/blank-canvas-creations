
-- Update get_my_org_id to try multiple header reading approaches
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
    current_setting('request.header.x-clerk-user-id', true),
    (current_setting('request.headers', true)::json->>'x-clerk-user-id')
  )
  LIMIT 1;
$$;

-- Update get_my_role similarly
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT om.role
  FROM public.org_members om
  WHERE om.clerk_user_id = COALESCE(
    auth.jwt() ->> 'sub',
    current_setting('request.header.x-clerk-user-id', true),
    (current_setting('request.headers', true)::json->>'x-clerk-user-id')
  )
    AND om.status = 'active'
  LIMIT 1;
$$;
