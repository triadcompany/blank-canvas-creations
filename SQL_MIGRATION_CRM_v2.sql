-- =============================================
-- MIGRAÇÃO CRM v2 - COM TRATAMENTO DE CONFLITOS
-- =============================================

-- =============================================
-- 1. CRIAR ENUMS (SE NÃO EXISTIREM)
-- =============================================
DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('admin', 'seller');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('baixa', 'media', 'alta');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('pendente', 'em_andamento', 'concluida', 'atrasada');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- 2. CRIAR TABELAS (IF NOT EXISTS)
-- =============================================

-- Organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  cnpj text,
  email text,
  phone text,
  address text,
  city text,
  state text,
  zip_code text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  avatar_url text,
  organization_id uuid REFERENCES public.organizations(id),
  whatsapp_e164 text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- User Roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role app_role NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

-- User Invitations
CREATE TABLE IF NOT EXISTS public.user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  email text NOT NULL,
  name text NOT NULL,
  role app_role DEFAULT 'seller',
  invited_by uuid,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Pipelines
CREATE TABLE IF NOT EXISTS public.pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_default boolean DEFAULT false,
  is_active boolean DEFAULT true,
  organization_id uuid REFERENCES public.organizations(id),
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Pipeline Stages
CREATE TABLE IF NOT EXISTS public.pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  position integer NOT NULL,
  color text DEFAULT '#6B7280',
  pipeline_id uuid REFERENCES public.pipelines(id),
  is_active boolean DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Lead Sources
CREATE TABLE IF NOT EXISTS public.lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Leads
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  interest text,
  price text,
  source text,
  observations text,
  stage_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  organization_id uuid REFERENCES public.organizations(id),
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Lead Assignment
CREATE TABLE IF NOT EXISTS public.lead_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  assigned_user_id uuid NOT NULL,
  assigned_at timestamptz DEFAULT now()
);

-- Lead Inbox
CREATE TABLE IF NOT EXISTS public.lead_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  payload jsonb,
  status text DEFAULT 'pending',
  lead_id uuid REFERENCES public.leads(id),
  received_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Lead Distribution Settings
CREATE TABLE IF NOT EXISTS public.lead_distribution_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id),
  is_auto_distribution_enabled boolean DEFAULT false,
  mode text DEFAULT 'manual',
  distribution_type text DEFAULT 'round_robin',
  manual_receiver_id uuid,
  rr_cursor integer DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Lead Distribution Users
CREATE TABLE IF NOT EXISTS public.lead_distribution_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_setting_id uuid NOT NULL REFERENCES public.lead_distribution_settings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  is_active boolean DEFAULT true,
  order_position integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Lead Distribution Rules
CREATE TABLE IF NOT EXISTS public.lead_distribution_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_setting_id uuid NOT NULL REFERENCES public.lead_distribution_settings(id) ON DELETE CASCADE,
  assigned_user_id uuid NOT NULL,
  days_of_week integer[] DEFAULT '{1,2,3,4,5}',
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Lead Distribution State
CREATE TABLE IF NOT EXISTS public.lead_distribution_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_setting_id uuid NOT NULL UNIQUE REFERENCES public.lead_distribution_settings(id) ON DELETE CASCADE,
  last_assigned_user_id uuid,
  last_assignment_at timestamptz,
  assignment_count integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- Lead Distribution Audit
CREATE TABLE IF NOT EXISTS public.lead_distribution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  data jsonb,
  created_at timestamptz DEFAULT now()
);

-- Prospects
CREATE TABLE IF NOT EXISTS public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj text NOT NULL,
  company_name text,
  trade_name text,
  owner_name text,
  owner_phone text,
  owner_email text,
  address text,
  city text,
  state text,
  main_activity text,
  status text DEFAULT 'new',
  raw_data jsonb,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tasks
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descricao text,
  data_hora timestamptz NOT NULL,
  prioridade task_priority DEFAULT 'media',
  status task_status DEFAULT 'pendente',
  responsavel_id uuid NOT NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  notificado boolean DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Vehicles
CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  model text NOT NULL,
  year integer NOT NULL,
  color text,
  plate text,
  price numeric,
  mileage integer,
  fuel_type text,
  transmission text,
  description text,
  images text[],
  status text DEFAULT 'available',
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- WhatsApp Integrations
CREATE TABLE IF NOT EXISTS public.whatsapp_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id),
  is_active boolean DEFAULT false,
  phone_number text,
  api_key text,
  webhook_url text,
  webhook_token text,
  evolution_instance_id text,
  evolution_api_key text,
  n8n_webhook_evolution_notify text,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Meta Integrations
CREATE TABLE IF NOT EXISTS public.meta_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id),
  pixel_id text NOT NULL,
  access_token text NOT NULL,
  is_active boolean DEFAULT true,
  test_mode boolean DEFAULT false,
  track_lead_qualificado boolean DEFAULT true,
  track_lead_super_qualificado boolean DEFAULT true,
  track_lead_veio_loja boolean DEFAULT true,
  track_lead_comprou boolean DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Meta Events Log
CREATE TABLE IF NOT EXISTS public.meta_events_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  lead_id uuid REFERENCES public.leads(id),
  event_name text NOT NULL,
  event_id text NOT NULL,
  event_time bigint NOT NULL,
  payload jsonb NOT NULL,
  response jsonb,
  success boolean,
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- =============================================
-- 3. HABILITAR RLS EM TODAS AS TABELAS
-- =============================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_events_log ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 4. FUNÇÕES AUXILIARES
-- =============================================
CREATE OR REPLACE FUNCTION public.get_user_organization_id(user_uuid uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE user_id = user_uuid;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid uuid)
RETURNS app_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = user_uuid LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =============================================
-- 5. CRIAR VIEW PROFILES_WITH_ROLES
-- =============================================
CREATE OR REPLACE VIEW public.profiles_with_roles AS
SELECT 
  p.id,
  p.user_id,
  p.name,
  p.email,
  p.avatar_url,
  p.organization_id,
  p.whatsapp_e164,
  p.created_at,
  p.updated_at,
  ur.role
FROM public.profiles p
LEFT JOIN public.user_roles ur ON p.user_id = ur.user_id;

-- =============================================
-- 6. DROP E CRIAR POLÍTICAS RLS
-- =============================================

-- Organizations policies
DROP POLICY IF EXISTS "Users can view their organization" ON public.organizations;
CREATE POLICY "Users can view their organization" ON public.organizations
  FOR SELECT USING (id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can update their organization" ON public.organizations;
CREATE POLICY "Admins can update their organization" ON public.organizations
  FOR UPDATE USING (id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- Profiles policies
DROP POLICY IF EXISTS "Users can view profiles in their org" ON public.profiles;
CREATE POLICY "Users can view profiles in their org" ON public.profiles
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- User Roles policies
DROP POLICY IF EXISTS "Users can view roles in their org" ON public.user_roles;
CREATE POLICY "Users can view roles in their org" ON public.user_roles
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- User Invitations policies
DROP POLICY IF EXISTS "Admins can view invitations" ON public.user_invitations;
CREATE POLICY "Admins can view invitations" ON public.user_invitations
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can manage invitations" ON public.user_invitations;
CREATE POLICY "Admins can manage invitations" ON public.user_invitations
  FOR ALL USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- Pipelines policies
DROP POLICY IF EXISTS "Users can view pipelines in their org" ON public.pipelines;
CREATE POLICY "Users can view pipelines in their org" ON public.pipelines
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage pipelines" ON public.pipelines;
CREATE POLICY "Admins can manage pipelines" ON public.pipelines
  FOR ALL USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- Pipeline Stages policies
DROP POLICY IF EXISTS "Users can view stages" ON public.pipeline_stages;
CREATE POLICY "Users can view stages" ON public.pipeline_stages
  FOR SELECT USING (
    pipeline_id IN (SELECT id FROM public.pipelines WHERE organization_id = get_user_organization_id(auth.uid()))
  );

DROP POLICY IF EXISTS "Admins can manage stages" ON public.pipeline_stages;
CREATE POLICY "Admins can manage stages" ON public.pipeline_stages
  FOR ALL USING (
    pipeline_id IN (SELECT id FROM public.pipelines WHERE organization_id = get_user_organization_id(auth.uid()))
    AND has_role(auth.uid(), 'admin')
  );

-- Lead Sources policies
DROP POLICY IF EXISTS "Users can view lead sources" ON public.lead_sources;
CREATE POLICY "Users can view lead sources" ON public.lead_sources
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage lead sources" ON public.lead_sources;
CREATE POLICY "Admins can manage lead sources" ON public.lead_sources
  FOR ALL USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- Leads policies
DROP POLICY IF EXISTS "Users can view leads in their org" ON public.leads;
CREATE POLICY "Users can view leads in their org" ON public.leads
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert leads" ON public.leads;
CREATE POLICY "Users can insert leads" ON public.leads
  FOR INSERT WITH CHECK (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update their leads or admins all" ON public.leads;
CREATE POLICY "Users can update their leads or admins all" ON public.leads
  FOR UPDATE USING (
    organization_id = get_user_organization_id(auth.uid()) AND (
      seller_id = (SELECT id FROM profiles WHERE user_id = auth.uid()) OR
      has_role(auth.uid(), 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can delete leads" ON public.leads;
CREATE POLICY "Admins can delete leads" ON public.leads
  FOR DELETE USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- Lead Assignment policies
DROP POLICY IF EXISTS "Users can view assignments in their org" ON public.lead_assignment;
CREATE POLICY "Users can view assignments in their org" ON public.lead_assignment
  FOR SELECT USING (
    lead_id IN (SELECT id FROM public.leads WHERE organization_id = get_user_organization_id(auth.uid()))
  );

DROP POLICY IF EXISTS "System can manage assignments" ON public.lead_assignment;
CREATE POLICY "System can manage assignments" ON public.lead_assignment
  FOR ALL USING (true);

-- Lead Inbox policies
DROP POLICY IF EXISTS "Admins can view inbox" ON public.lead_inbox;
CREATE POLICY "Admins can view inbox" ON public.lead_inbox
  FOR SELECT USING (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "System can insert inbox" ON public.lead_inbox;
CREATE POLICY "System can insert inbox" ON public.lead_inbox
  FOR INSERT WITH CHECK (true);

-- Distribution Settings policies
DROP POLICY IF EXISTS "Users can view distribution settings" ON public.lead_distribution_settings;
CREATE POLICY "Users can view distribution settings" ON public.lead_distribution_settings
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage distribution settings" ON public.lead_distribution_settings;
CREATE POLICY "Admins can manage distribution settings" ON public.lead_distribution_settings
  FOR ALL USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- Distribution Users policies
DROP POLICY IF EXISTS "Users can view distribution users" ON public.lead_distribution_users;
CREATE POLICY "Users can view distribution users" ON public.lead_distribution_users
  FOR SELECT USING (
    distribution_setting_id IN (SELECT id FROM public.lead_distribution_settings WHERE organization_id = get_user_organization_id(auth.uid()))
  );

DROP POLICY IF EXISTS "Admins can manage distribution users" ON public.lead_distribution_users;
CREATE POLICY "Admins can manage distribution users" ON public.lead_distribution_users
  FOR ALL USING (
    distribution_setting_id IN (SELECT id FROM public.lead_distribution_settings WHERE organization_id = get_user_organization_id(auth.uid()))
    AND has_role(auth.uid(), 'admin')
  );

-- Distribution Rules policies
DROP POLICY IF EXISTS "Users can view distribution rules" ON public.lead_distribution_rules;
CREATE POLICY "Users can view distribution rules" ON public.lead_distribution_rules
  FOR SELECT USING (
    distribution_setting_id IN (SELECT id FROM public.lead_distribution_settings WHERE organization_id = get_user_organization_id(auth.uid()))
  );

DROP POLICY IF EXISTS "Admins can manage distribution rules" ON public.lead_distribution_rules;
CREATE POLICY "Admins can manage distribution rules" ON public.lead_distribution_rules
  FOR ALL USING (
    distribution_setting_id IN (SELECT id FROM public.lead_distribution_settings WHERE organization_id = get_user_organization_id(auth.uid()))
    AND has_role(auth.uid(), 'admin')
  );

-- Distribution State policies
DROP POLICY IF EXISTS "Users can view distribution state" ON public.lead_distribution_state;
CREATE POLICY "Users can view distribution state" ON public.lead_distribution_state
  FOR SELECT USING (
    distribution_setting_id IN (SELECT id FROM public.lead_distribution_settings WHERE organization_id = get_user_organization_id(auth.uid()))
  );

DROP POLICY IF EXISTS "System can manage distribution state" ON public.lead_distribution_state;
CREATE POLICY "System can manage distribution state" ON public.lead_distribution_state
  FOR ALL USING (true);

-- Distribution Audit policies
DROP POLICY IF EXISTS "Admins can view audit" ON public.lead_distribution_audit;
CREATE POLICY "Admins can view audit" ON public.lead_distribution_audit
  FOR SELECT USING (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "System can insert audit" ON public.lead_distribution_audit;
CREATE POLICY "System can insert audit" ON public.lead_distribution_audit
  FOR INSERT WITH CHECK (true);

-- Prospects policies
DROP POLICY IF EXISTS "Users can view prospects" ON public.prospects;
CREATE POLICY "Users can view prospects" ON public.prospects
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Users can manage prospects" ON public.prospects;
CREATE POLICY "Users can manage prospects" ON public.prospects
  FOR ALL USING (organization_id = get_user_organization_id(auth.uid()));

-- Tasks policies
DROP POLICY IF EXISTS "Users can view tasks in their org" ON public.tasks;
CREATE POLICY "Users can view tasks in their org" ON public.tasks
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Users can insert tasks" ON public.tasks;
CREATE POLICY "Users can insert tasks" ON public.tasks
  FOR INSERT WITH CHECK (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update their tasks" ON public.tasks;
CREATE POLICY "Users can update their tasks" ON public.tasks
  FOR UPDATE USING (
    organization_id = get_user_organization_id(auth.uid()) AND (
      responsavel_id = (SELECT id FROM profiles WHERE user_id = auth.uid()) OR
      has_role(auth.uid(), 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can delete tasks" ON public.tasks;
CREATE POLICY "Admins can delete tasks" ON public.tasks
  FOR DELETE USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- Vehicles policies
DROP POLICY IF EXISTS "Users can view vehicles" ON public.vehicles;
CREATE POLICY "Users can view vehicles" ON public.vehicles
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Users can manage vehicles" ON public.vehicles;
CREATE POLICY "Users can manage vehicles" ON public.vehicles
  FOR ALL USING (organization_id = get_user_organization_id(auth.uid()));

-- WhatsApp Integrations policies
DROP POLICY IF EXISTS "Users can view whatsapp config" ON public.whatsapp_integrations;
CREATE POLICY "Users can view whatsapp config" ON public.whatsapp_integrations
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage whatsapp config" ON public.whatsapp_integrations;
CREATE POLICY "Admins can manage whatsapp config" ON public.whatsapp_integrations
  FOR ALL USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- Meta Integrations policies
DROP POLICY IF EXISTS "Users can view meta config" ON public.meta_integrations;
CREATE POLICY "Users can view meta config" ON public.meta_integrations
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage meta config" ON public.meta_integrations;
CREATE POLICY "Admins can manage meta config" ON public.meta_integrations
  FOR ALL USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- Meta Events Log policies
DROP POLICY IF EXISTS "Users can view meta events" ON public.meta_events_log;
CREATE POLICY "Users can view meta events" ON public.meta_events_log
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

DROP POLICY IF EXISTS "System can insert meta events" ON public.meta_events_log;
CREATE POLICY "System can insert meta events" ON public.meta_events_log
  FOR INSERT WITH CHECK (true);

-- =============================================
-- 7. FUNÇÃO HANDLE_NEW_USER
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    
    INSERT INTO public.lead_distribution_settings (
      organization_id,
      is_auto_distribution_enabled,
      mode,
      created_by
    ) VALUES (
      org_id,
      false,
      'manual',
      profile_id
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- =============================================
-- 8. CRIAR TRIGGER (DROP FIRST)
-- =============================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- 9. STORAGE BUCKET
-- =============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
CREATE POLICY "Avatar images are publicly accessible" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar" ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- =============================================
-- MIGRAÇÃO COMPLETA!
-- =============================================
