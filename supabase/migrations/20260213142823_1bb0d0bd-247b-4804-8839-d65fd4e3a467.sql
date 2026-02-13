
-- Fix get_my_org_id and is_org_admin to reliably extract clerk user id from PostgREST headers
-- PostgREST stores headers in request.headers as a JSON string

CREATE OR REPLACE FUNCTION public.get_clerk_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    nullif(auth.jwt() ->> 'sub', ''),
    nullif(current_setting('request.header.x-clerk-user-id', true), ''),
    (
      SELECT val FROM (
        SELECT current_setting('request.headers', true) AS raw
      ) h
      CROSS JOIN LATERAL (
        SELECT h.raw::json->>'x-clerk-user-id' AS val
      ) parsed
      WHERE h.raw IS NOT NULL AND h.raw != ''
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id 
  FROM public.profiles 
  WHERE clerk_user_id = public.get_clerk_user_id()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members 
    WHERE clerk_user_id = public.get_clerk_user_id()
    AND role = 'admin'
  );
$$;
