-- Add unique constraint on (clerk_user_id, organization_id) for user_roles upserts
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_clerk_user_id_organization_id_key UNIQUE (clerk_user_id, organization_id);

-- Also insert the missing admin role for the current user
INSERT INTO public.user_roles (clerk_user_id, organization_id, role)
VALUES ('user_39lI8KI0f9SyZPUq9uwDkr3alNj', '24788a87-6421-4e4e-953a-73970dca2281', 'admin')
ON CONFLICT (clerk_user_id, organization_id) DO NOTHING;