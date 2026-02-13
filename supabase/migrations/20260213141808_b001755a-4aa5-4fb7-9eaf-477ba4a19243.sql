CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members 
    WHERE clerk_user_id = COALESCE(
      auth.jwt() ->> 'sub',
      current_setting('request.header.x-clerk-user-id', true),
      (current_setting('request.headers', true)::json->>'x-clerk-user-id')
    )
    AND role = 'admin'
  );
$$;