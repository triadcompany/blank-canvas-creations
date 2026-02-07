-- Ensure authenticated users can read/update roles (RLS still applies)
GRANT USAGE ON TYPE public.app_role TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.user_roles TO authenticated;

-- Optional: allow admins to insert roles when provisioning users (RLS controls who)
GRANT INSERT ON TABLE public.user_roles TO authenticated;