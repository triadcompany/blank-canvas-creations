-- ============================================
-- SECURITY FIX MIGRATION (with data cleanup)
-- ============================================

-- ============================================
-- STEP 0: Clean existing data that violates constraints
-- ============================================

-- Truncate phone numbers that are too long
UPDATE public.leads 
SET phone = LEFT(phone, 20) 
WHERE char_length(phone) > 20;

-- Truncate names that are too long
UPDATE public.leads 
SET name = LEFT(name, 100) 
WHERE char_length(name) > 100;

-- Truncate emails that are too long
UPDATE public.leads 
SET email = LEFT(email, 255) 
WHERE char_length(email) > 255;

-- Truncate observations that are too long
UPDATE public.leads 
SET observations = LEFT(observations, 2000) 
WHERE char_length(observations) > 2000;

-- Clean profiles table
UPDATE public.profiles 
SET name = LEFT(name, 100) 
WHERE char_length(name) > 100;

UPDATE public.profiles 
SET email = LEFT(email, 255) 
WHERE char_length(email) > 255;

-- Clean tasks table
UPDATE public.tasks 
SET titulo = LEFT(titulo, 200) 
WHERE char_length(titulo) > 200;

UPDATE public.tasks 
SET descricao = LEFT(descricao, 2000) 
WHERE char_length(descricao) > 2000;

-- ============================================
-- STEP 1: Create user_roles table and function
-- ============================================

CREATE TABLE IF NOT EXISTS public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (user_id, organization_id)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- Migrate existing roles from profiles to user_roles
INSERT INTO public.user_roles (user_id, role, organization_id)
SELECT user_id, role, organization_id
FROM public.profiles
WHERE user_id IS NOT NULL AND organization_id IS NOT NULL
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- RLS policies for user_roles
CREATE POLICY "Users can view their own role"
ON public.user_roles FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Admins can view organization roles"
ON public.user_roles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() 
    AND ur.organization_id = user_roles.organization_id
    AND ur.role = 'admin'
  )
);

CREATE POLICY "Admins can manage organization roles"
ON public.user_roles FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() 
    AND ur.organization_id = user_roles.organization_id
    AND ur.role = 'admin'
  )
);

-- ============================================
-- STEP 2: Update get_user_role to use new table
-- ============================================

CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid uuid)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = user_uuid LIMIT 1;
$$;

-- ============================================
-- STEP 3: Fix lead_distribution_state RLS
-- ============================================

DROP POLICY IF EXISTS "System can manage distribution state" ON public.lead_distribution_state;

CREATE POLICY "Organization members can manage distribution state"
ON public.lead_distribution_state FOR ALL
USING (
  distribution_setting_id IN (
    SELECT id FROM public.lead_distribution_settings
    WHERE organization_id = get_user_organization_id(auth.uid())
  )
);

-- ============================================
-- STEP 4: Fix whatsapp_integrations RLS
-- ============================================

DROP POLICY IF EXISTS "Users can view organization whatsapp integrations" ON public.whatsapp_integrations;

CREATE POLICY "Only admins can view whatsapp integrations"
ON public.whatsapp_integrations FOR SELECT
USING (
  has_role(auth.uid(), 'admin') 
  AND organization_id = get_user_organization_id(auth.uid())
);

CREATE OR REPLACE FUNCTION public.has_whatsapp_integration()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.whatsapp_integrations
    WHERE organization_id = get_user_organization_id(auth.uid())
    AND is_active = true
  );
$$;

-- ============================================
-- STEP 5: Fix cross-organization invitation leakage
-- ============================================

DROP POLICY IF EXISTS "Admins can manage organization invitations" ON public.user_invitations;

CREATE POLICY "Admins can manage organization invitations"
ON public.user_invitations FOR ALL
USING (
  has_role(auth.uid(), 'admin')
  AND organization_id = get_user_organization_id(auth.uid())
);

-- ============================================
-- STEP 6: Add input validation constraints
-- ============================================

ALTER TABLE public.leads 
  ADD CONSTRAINT leads_phone_length CHECK (char_length(phone) <= 20),
  ADD CONSTRAINT leads_name_length CHECK (char_length(name) <= 100),
  ADD CONSTRAINT leads_email_length CHECK (char_length(email) <= 255),
  ADD CONSTRAINT leads_observations_length CHECK (char_length(observations) <= 2000);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_name_length CHECK (char_length(name) <= 100),
  ADD CONSTRAINT profiles_email_length CHECK (char_length(email) <= 255);

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_titulo_length CHECK (char_length(titulo) <= 200),
  ADD CONSTRAINT tasks_descricao_length CHECK (char_length(descricao) <= 2000);

-- ============================================
-- STEP 7: Update handle_new_user to use user_roles
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  org_id uuid;
  profile_id uuid;
  pipeline_id uuid;
  invitation_record user_invitations%ROWTYPE;
  user_role app_role := 'admin';
BEGIN
  SELECT * INTO invitation_record
  FROM user_invitations 
  WHERE email = NEW.email 
  AND status IN ('pending', 'direct_creation')
  ORDER BY created_at DESC 
  LIMIT 1;
  
  IF invitation_record.id IS NOT NULL THEN
    org_id := invitation_record.organization_id;
    user_role := invitation_record.role;
    
    UPDATE user_invitations 
    SET status = 'accepted' 
    WHERE id = invitation_record.id;
    
    INSERT INTO public.profiles (user_id, name, email, organization_id)
    VALUES (NEW.id, invitation_record.name, NEW.email, org_id)
    RETURNING id INTO profile_id;
    
    INSERT INTO public.user_roles (user_id, role, organization_id)
    VALUES (NEW.id, user_role, org_id);
  ELSE
    INSERT INTO public.organizations (id, name, email, is_active)
    VALUES (gen_random_uuid(), COALESCE(NEW.raw_user_meta_data ->> 'organization_name', 'Minha Empresa'), NEW.email, true)
    RETURNING id INTO org_id;
    
    INSERT INTO public.profiles (user_id, name, email, organization_id)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'name', NEW.email), NEW.email, org_id)
    RETURNING id INTO profile_id;
    
    INSERT INTO public.user_roles (user_id, role, organization_id)
    VALUES (NEW.id, 'admin', org_id);
    
    INSERT INTO public.pipelines (name, description, is_default, is_active, organization_id, created_by)
    VALUES ('Pipeline de Vendas', 'Pipeline padrão', true, true, org_id, profile_id)
    RETURNING id INTO pipeline_id;
    
    INSERT INTO public.pipeline_stages (name, position, color, pipeline_id, created_by) VALUES
      ('Novo Lead', 1, '#6B7280', pipeline_id, profile_id),
      ('Andamento', 2, '#3B82F6', pipeline_id, profile_id),
      ('Qualificado', 3, '#10B981', pipeline_id, profile_id),
      ('Agendado', 4, '#F59E0B', pipeline_id, profile_id),
      ('Proposta Enviada', 5, '#8B5CF6', pipeline_id, profile_id),
      ('Venda', 6, '#22C55E', pipeline_id, profile_id),
      ('Follow Up', 7, '#06B6D4', pipeline_id, profile_id),
      ('Perdido', 8, '#EF4444', pipeline_id, profile_id);
  END IF;
  
  RETURN NEW;
END;
$function$;