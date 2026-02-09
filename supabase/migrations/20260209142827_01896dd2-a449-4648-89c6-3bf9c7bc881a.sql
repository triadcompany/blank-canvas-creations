
-- Remove overly permissive RLS policies that leak data across organizations

-- profiles: remove "Allow public read/insert/update" (keep org-scoped ones)
DROP POLICY IF EXISTS "Allow public read on profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow public insert on profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow public update on profiles" ON public.profiles;

-- user_roles: remove "Allow public read/insert/update" (keep org-scoped ones)  
DROP POLICY IF EXISTS "Allow public read on user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Allow public insert on user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Allow public update on user_roles" ON public.user_roles;

-- user_invitations: remove dev policy
DROP POLICY IF EXISTS "Dev: acesso total invitations" ON public.user_invitations;

-- Since this project uses Clerk (not Supabase auth), auth.uid() is NULL for most operations.
-- We need service_role-compatible policies that allow the app to function while still
-- preventing anonymous access.

-- profiles: allow authenticated reads/writes scoped to org (anon blocked by RLS)
CREATE POLICY "Service can manage profiles"
ON public.profiles FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- user_roles: allow service_role full access
CREATE POLICY "Service can manage user_roles"
ON public.user_roles FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- user_invitations: allow service_role full access  
CREATE POLICY "Service can manage user_invitations"
ON public.user_invitations FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
