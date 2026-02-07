
-- Create app_role enum type
CREATE TYPE public.app_role AS ENUM ('admin', 'seller');

-- Create organizations table
CREATE TABLE public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    cnpj TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create profiles table
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_user_id TEXT UNIQUE,
    user_id TEXT,
    email TEXT,
    name TEXT,
    avatar_url TEXT,
    whatsapp_e164 TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_user_id TEXT NOT NULL,
    user_id TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    role app_role NOT NULL DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (clerk_user_id, role)
);

-- Create indexes for performance
CREATE INDEX idx_profiles_clerk_user_id ON public.profiles(clerk_user_id);
CREATE INDEX idx_profiles_organization_id ON public.profiles(organization_id);
CREATE INDEX idx_user_roles_clerk_user_id ON public.user_roles(clerk_user_id);

-- Enable RLS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Temporarily allow all operations for provisioning to work
-- These will be tightened after confirming auth flow works
CREATE POLICY "Allow all for now" ON public.organizations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for now" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for now" ON public.user_roles FOR ALL USING (true) WITH CHECK (true);

-- Grant permissions
GRANT ALL ON public.organizations TO anon, authenticated;
GRANT ALL ON public.profiles TO anon, authenticated;
GRANT ALL ON public.user_roles TO anon, authenticated;
GRANT USAGE ON TYPE public.app_role TO anon, authenticated;
