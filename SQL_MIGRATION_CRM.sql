-- =============================================================
-- MIGRAÇÃO COMPLETA PARA SUPABASE CRM
-- Execute este script no Editor SQL do Supabase
-- https://supabase.com/dashboard/project/tapbwlmdvluqdgvixkxf/sql/new
-- =============================================================

-- HABILITAR EXTENSÕES
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- =============================================================
-- ENUMS
-- =============================================================

CREATE TYPE public.app_role AS ENUM ('admin', 'seller');
CREATE TYPE public.task_priority AS ENUM ('baixa', 'media', 'alta');
CREATE TYPE public.task_status AS ENUM ('pendente', 'em_andamento', 'concluida', 'atrasada');

-- =============================================================
-- TABELAS CORE
-- =============================================================

-- Organizações
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  cnpj text,
  email text,
  phone text,
  address text,
  city text,
  state text,
  zip_code text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Perfis de usuários
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id),
  name text NOT NULL,
  email text NOT NULL,
  avatar_url text,
  whatsapp_e164 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Roles de usuários (separado para segurança)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- Convites de usuários
CREATE TABLE public.user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  email text NOT NULL,
  name text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'seller',
  invited_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
-- TABELAS DE PIPELINE
-- =============================================================

-- Pipelines
CREATE TABLE public.pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  name text NOT NULL,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Estágios do pipeline
CREATE TABLE public.pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid REFERENCES public.pipelines(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL,
  color text NOT NULL DEFAULT '#3B82F6',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
-- TABELAS DE LEADS
-- =============================================================

-- Leads
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  source text,
  interest text,
  price text,
  observations text,
  stage_id uuid NOT NULL REFERENCES public.pipeline_stages(id),
  seller_id uuid NOT NULL REFERENCES public.profiles(id),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fontes de leads
CREATE TABLE public.lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Lead inbox (recebimento de leads)
CREATE TABLE public.lead_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  lead_id uuid REFERENCES public.leads(id),
  payload jsonb,
  status text NOT NULL DEFAULT 'novo',
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Atribuição de leads
CREATE TABLE public.lead_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) UNIQUE,
  assigned_user_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
-- TABELAS DE DISTRIBUIÇÃO DE LEADS
-- =============================================================

-- Configurações de distribuição
CREATE TABLE public.lead_distribution_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) UNIQUE,
  is_auto_distribution_enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'manual',
  distribution_type text NOT NULL DEFAULT 'manual',
  manual_receiver_id uuid,
  rr_cursor integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Usuários na distribuição
CREATE TABLE public.lead_distribution_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_setting_id uuid NOT NULL REFERENCES public.lead_distribution_settings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  order_position integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Regras de distribuição (horários)
CREATE TABLE public.lead_distribution_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_setting_id uuid NOT NULL REFERENCES public.lead_distribution_settings(id) ON DELETE CASCADE,
  assigned_user_id uuid NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  days_of_week integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Estado da distribuição
CREATE TABLE public.lead_distribution_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_setting_id uuid NOT NULL REFERENCES public.lead_distribution_settings(id) UNIQUE,
  last_assigned_user_id uuid,
  last_assignment_at timestamptz,
  assignment_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auditoria de distribuição
CREATE TABLE public.lead_distribution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
-- TABELAS DE TAREFAS
-- =============================================================

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  titulo text NOT NULL,
  descricao text,
  data_hora timestamptz NOT NULL,
  prioridade public.task_priority NOT NULL DEFAULT 'media',
  status public.task_status NOT NULL DEFAULT 'pendente',
  responsavel_id uuid NOT NULL REFERENCES public.profiles(id),
  lead_id uuid REFERENCES public.leads(id),
  notificado boolean DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- TABELAS DE VEÍCULOS
-- =============================================================

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  brand text NOT NULL,
  model text NOT NULL,
  year integer NOT NULL,
  price numeric,
  mileage integer,
  color text,
  fuel_type text,
  transmission text,
  plate text,
  description text,
  images text[],
  status text NOT NULL DEFAULT 'available',
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
-- TABELAS DE PROSPECÇÃO
-- =============================================================

CREATE TABLE public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  cnpj text NOT NULL,
  company_name text,
  trade_name text,
  main_activity text,
  owner_name text,
  owner_phone text,
  owner_email text,
  address text,
  city text,
  state text,
  status text,
  raw_data jsonb,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
-- TABELAS DE INTEGRAÇÕES
-- =============================================================

-- Integração WhatsApp
CREATE TABLE public.whatsapp_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  is_active boolean NOT NULL DEFAULT true,
  phone_number text,
  api_key text,
  webhook_url text,
  webhook_token text DEFAULT gen_random_uuid()::text,
  evolution_instance_id text,
  evolution_api_key text,
  n8n_webhook_evolution_notify text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Integração Meta/Facebook
CREATE TABLE public.meta_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  pixel_id text NOT NULL,
  access_token text NOT NULL,
  is_active boolean DEFAULT true,
  test_mode boolean DEFAULT false,
  track_lead_qualificado boolean DEFAULT true,
  track_lead_super_qualificado boolean DEFAULT true,
  track_lead_comprou boolean DEFAULT true,
  track_lead_veio_loja boolean DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Log de eventos Meta
CREATE TABLE public.meta_events_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  lead_id uuid REFERENCES public.leads(id),
  event_name text NOT NULL,
  event_id text NOT NULL,
  event_time bigint NOT NULL,
  payload jsonb NOT NULL,
  response jsonb,
  success boolean DEFAULT false,
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- =============================================================
-- VIEW: profiles_with_roles
-- =============================================================

CREATE OR REPLACE VIEW public.profiles_with_roles AS
SELECT 
  p.id,
  p.user_id,
  p.organization_id,
  p.name,
  p.email,
  p.avatar_url,
  p.whatsapp_e164,
  p.created_at,
  p.updated_at,
  ur.role
FROM public.profiles p
LEFT JOIN public.user_roles ur ON p.user_id = ur.user_id;

-- =============================================================
-- FUNÇÕES AUXILIARES
-- =============================================================

-- Função para obter organization_id do usuário
CREATE OR REPLACE FUNCTION public.get_user_organization_id(user_uuid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE user_id = user_uuid;
$$;

-- Função para obter role do usuário
CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = user_uuid LIMIT 1;
$$;

-- Função para verificar se usuário tem role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
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

-- Função para verificar se usuário pode atualizar lead
CREATE OR REPLACE FUNCTION public.can_user_update_lead(lead_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM leads l
    JOIN profiles p ON p.user_id = user_id
    WHERE l.id = lead_id 
    AND l.organization_id = p.organization_id
    AND (
      l.seller_id = p.id
      OR has_role(user_id, 'admin'::app_role)
    )
  );
$$;

-- Função para verificar integração WhatsApp
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

-- Função para atualizar updated_at
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

-- Função para marcar tarefas atrasadas
CREATE OR REPLACE FUNCTION public.mark_overdue_tasks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE tasks
  SET status = 'atrasada'
  WHERE status IN ('pendente', 'em_andamento')
    AND data_hora < now()
    AND status != 'concluida';
END;
$$;

-- =============================================================
-- FUNÇÃO: handle_new_user (Trigger para novos usuários)
-- =============================================================

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

-- Trigger para novos usuários
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================
-- FUNÇÃO: distribute_lead (Distribuição automática de leads)
-- =============================================================

CREATE OR REPLACE FUNCTION public.distribute_lead(p_lead_id uuid, p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings lead_distribution_settings%ROWTYPE;
  v_users uuid[];
  v_cursor integer;
  v_assigned_user_id uuid;
  v_next_cursor integer;
  v_assignment_exists boolean;
  v_user_count integer;
  v_lock_acquired boolean;
  v_cursor_verified integer;
BEGIN
  SELECT pg_try_advisory_xact_lock(hashtext('lead_distribution_' || p_organization_id::text)) INTO v_lock_acquired;
  
  IF NOT v_lock_acquired THEN
    PERFORM pg_sleep(0.1);
    SELECT pg_try_advisory_xact_lock(hashtext('lead_distribution_' || p_organization_id::text)) INTO v_lock_acquired;
    
    IF NOT v_lock_acquired THEN
      RAISE EXCEPTION 'Could not acquire lock for lead distribution after retry';
    END IF;
  END IF;
  
  SELECT EXISTS(
    SELECT 1 FROM lead_assignment WHERE lead_id = p_lead_id
  ) INTO v_assignment_exists;
  
  IF v_assignment_exists THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_assigned', true,
      'message', 'Lead já atribuído anteriormente'
    );
  END IF;
  
  SELECT * INTO v_settings
  FROM lead_distribution_settings
  WHERE organization_id = p_organization_id
    AND is_auto_distribution_enabled = true
  FOR UPDATE
  LIMIT 1;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Distribuição desabilitada ou não configurada';
  END IF;
  
  IF v_settings.mode = 'manual' THEN
    IF v_settings.manual_receiver_id IS NULL THEN
      RAISE EXCEPTION 'Receptor manual não configurado';
    END IF;
    
    v_assigned_user_id := v_settings.manual_receiver_id;
    
  ELSIF v_settings.mode = 'auto' THEN
    SELECT array_agg(user_id ORDER BY order_position)
    INTO v_users
    FROM lead_distribution_users
    WHERE distribution_setting_id = v_settings.id
      AND is_active = true;
    
    IF v_users IS NULL OR array_length(v_users, 1) = 0 THEN
      RAISE EXCEPTION 'Nenhum usuário selecionado para distribuição automática';
    END IF;
    
    v_user_count := array_length(v_users, 1);
    v_cursor := COALESCE(v_settings.rr_cursor, 0);
    v_cursor := v_cursor % v_user_count;
    
    v_assigned_user_id := v_users[v_cursor + 1];
    
    v_next_cursor := (v_cursor + 1) % v_user_count;
    
    UPDATE lead_distribution_settings
    SET rr_cursor = v_next_cursor,
        updated_at = now()
    WHERE id = v_settings.id;
    
    SELECT rr_cursor INTO v_cursor_verified
    FROM lead_distribution_settings
    WHERE id = v_settings.id;
    
  ELSE
    RAISE EXCEPTION 'Modo de distribuição inválido: %', v_settings.mode;
  END IF;
  
  INSERT INTO lead_assignment(lead_id, assigned_user_id)
  VALUES (p_lead_id, v_assigned_user_id);
  
  UPDATE leads
  SET seller_id = (
    SELECT id FROM profiles WHERE user_id = v_assigned_user_id LIMIT 1
  )
  WHERE id = p_lead_id;
  
  INSERT INTO lead_distribution_audit(event, data)
  VALUES (
    'lead.assigned',
    jsonb_build_object(
      'lead_id', p_lead_id,
      'assigned_user_id', v_assigned_user_id,
      'mode', v_settings.mode,
      'timestamp', now(),
      'organization_id', p_organization_id
    )
  );
  
  INSERT INTO lead_distribution_state(
    distribution_setting_id,
    last_assigned_user_id,
    last_assignment_at,
    assignment_count
  )
  VALUES (
    v_settings.id,
    v_assigned_user_id,
    now(),
    1
  )
  ON CONFLICT (distribution_setting_id)
  DO UPDATE SET
    last_assigned_user_id = EXCLUDED.last_assigned_user_id,
    last_assignment_at = EXCLUDED.last_assignment_at,
    assignment_count = lead_distribution_state.assignment_count + 1,
    updated_at = now();
  
  -- Notificação via WhatsApp
  BEGIN
    PERFORM net.http_post(
      url := 'https://tapbwlmdvluqdgvixkxf.supabase.co/functions/v1/notify-lead-assignment',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhcGJ3bG1kdmx1cWRndml4a3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2MDY0NDgsImV4cCI6MjA3MDE4MjQ0OH0.U2p9jneQ6Lcgu672Z8W-KnKhLgMLygDk1jB4a0YIwvQ'
      ),
      body := jsonb_build_object(
        'lead_id', p_lead_id,
        'assigned_user_id', v_assigned_user_id,
        'organization_id', p_organization_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Notification failed (non-critical): %', SQLERRM;
  END;
  
  RETURN jsonb_build_object(
    'ok', true,
    'assigned_user_id', v_assigned_user_id,
    'mode', v_settings.mode
  );
END;
$$;

-- =============================================================
-- FUNÇÃO: notify_meta_event (Trigger para eventos Meta)
-- =============================================================

CREATE OR REPLACE FUNCTION public.notify_meta_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_name TEXT;
  stage_name TEXT;
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.stage_id IS NOT DISTINCT FROM NEW.stage_id) THEN
    RETURN NEW;
  END IF;
  
  SELECT name INTO stage_name
  FROM pipeline_stages
  WHERE id = NEW.stage_id;
  
  IF stage_name ILIKE '%qualificado%' AND stage_name NOT ILIKE '%super%' AND stage_name NOT ILIKE '%proposta%' THEN
    event_name := 'Lead';
  ELSIF stage_name ILIKE '%proposta%' OR stage_name ILIKE '%proposta enviada%' THEN
    event_name := 'Lead_Super_Qualificado';
  ELSIF stage_name ILIKE '%venda%' OR stage_name ILIKE '%vendido%' OR stage_name ILIKE '%fechado%' THEN
    event_name := 'Purchase';
  ELSIF stage_name ILIKE '%agendado%' OR stage_name ILIKE '%agendamento%' THEN
    event_name := 'Lead_Veio_Loja';
  ELSE
    RETURN NEW;
  END IF;
  
  BEGIN
    PERFORM net.http_post(
      url := 'https://tapbwlmdvluqdgvixkxf.supabase.co/functions/v1/send-meta-event',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhcGJ3bG1kdmx1cWRndml4a3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2MDY0NDgsImV4cCI6MjA3MDE4MjQ0OH0.U2p9jneQ6Lcgu672Z8W-KnKhLgMLygDk1jB4a0YIwvQ'
      ),
      body := jsonb_build_object(
        'lead_id', NEW.id,
        'event_name', event_name,
        'stage_name', stage_name
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to send Meta event (non-critical): %', SQLERRM;
  END;
  
  RETURN NEW;
END;
$$;

-- Trigger para eventos Meta
CREATE TRIGGER on_lead_stage_change
  AFTER INSERT OR UPDATE OF stage_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.notify_meta_event();

-- =============================================================
-- FUNÇÕES ADICIONAIS
-- =============================================================

CREATE OR REPLACE FUNCTION public.invite_user_to_organization(inviter_user_id uuid, invite_email text, invite_name text, invite_role app_role DEFAULT 'seller'::app_role)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
  inviter_profile_id uuid;
  existing_user uuid;
BEGIN
  SELECT organization_id, id INTO org_id, inviter_profile_id
  FROM profiles 
  WHERE user_id = inviter_user_id;
  
  IF org_id IS NULL THEN
    RETURN json_build_object('error', 'Only admins can invite users');
  END IF;
  
  IF NOT has_role(inviter_user_id, 'admin') THEN
    RETURN json_build_object('error', 'Only admins can invite users');
  END IF;
  
  SELECT id INTO existing_user 
  FROM auth.users 
  WHERE email = invite_email;
  
  IF existing_user IS NOT NULL THEN
    RETURN json_build_object('error', 'User already exists');
  END IF;
  
  DELETE FROM user_invitations
  WHERE email = invite_email;
  
  INSERT INTO user_invitations (
    organization_id,
    email,
    name,
    role,
    invited_by,
    status
  ) VALUES (
    org_id,
    invite_email,
    invite_name,
    invite_role,
    inviter_profile_id,
    'pending'
  );
  
  RETURN json_build_object(
    'success', true, 
    'message', 'Invitation created successfully',
    'organization_id', org_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_user_in_organization(p_email text, p_name text, p_role app_role DEFAULT 'seller'::app_role, p_temp_password text DEFAULT 'temppass123'::text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
  result json;
  existing_user uuid;
BEGIN
  SELECT organization_id INTO org_id
  FROM profiles 
  WHERE user_id = auth.uid();
  
  IF org_id IS NULL OR NOT has_role(auth.uid(), 'admin') THEN
    RETURN json_build_object('error', 'Apenas administradores podem criar usuários');
  END IF;
  
  SELECT id INTO existing_user 
  FROM auth.users 
  WHERE email = p_email;
  
  IF existing_user IS NOT NULL THEN
    RETURN json_build_object('error', 'Usuário já existe com este email');
  END IF;
  
  DELETE FROM user_invitations 
  WHERE email = p_email;
  
  INSERT INTO user_invitations (
    organization_id,
    email,
    name,
    role,
    invited_by,
    status
  ) VALUES (
    org_id,
    p_email,
    p_name,
    p_role,
    (SELECT id FROM profiles WHERE user_id = auth.uid()),
    'direct_creation'
  );
  
  RETURN json_build_object(
    'success', true, 
    'message', 'Usuário pode agora se cadastrar no sistema',
    'organization_id', org_id,
    'email', p_email,
    'name', p_name,
    'role', p_role
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_distribution_cursor(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE lead_distribution_settings
  SET rr_cursor = 0,
      updated_at = now()
  WHERE organization_id = p_organization_id;
  
  INSERT INTO lead_distribution_audit(event, data)
  VALUES (
    'cursor.reset',
    jsonb_build_object(
      'organization_id', p_organization_id,
      'timestamp', now()
    )
  );
END;
$$;

-- =============================================================
-- HABILITAR RLS EM TODAS AS TABELAS
-- =============================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_events_log ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- POLÍTICAS RLS
-- =============================================================

-- Organizations
CREATE POLICY "Authenticated users can view their own organization" ON public.organizations
  FOR SELECT USING (auth.uid() IS NOT NULL AND id = get_user_organization_id(auth.uid()));

CREATE POLICY "Authenticated admins can update their organization" ON public.organizations
  FOR UPDATE USING (auth.uid() IS NOT NULL AND id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- Profiles
CREATE POLICY "Authenticated users can view their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "Authenticated admins can view organization profiles" ON public.profiles
  FOR SELECT USING (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin') AND organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Authenticated users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY "Authenticated admins can update organization profiles" ON public.profiles
  FOR UPDATE USING (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin') AND organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Authenticated admins can insert organization profiles" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin') AND organization_id = get_user_organization_id(auth.uid()));

-- User roles
CREATE POLICY "Users can view their own role" ON public.user_roles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can view organization roles" ON public.user_roles
  FOR SELECT USING (has_role(auth.uid(), 'admin') AND organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Admins can manage organization roles" ON public.user_roles
  FOR ALL USING (has_role(auth.uid(), 'admin') AND organization_id = get_user_organization_id(auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin') AND organization_id = get_user_organization_id(auth.uid()));

-- User invitations
CREATE POLICY "Admins can manage organization invitations" ON public.user_invitations
  FOR ALL USING (has_role(auth.uid(), 'admin') AND organization_id = get_user_organization_id(auth.uid()));

-- Pipelines
CREATE POLICY "Users can view organization pipelines" ON public.pipelines
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()) AND is_active = true);

CREATE POLICY "Users can manage organization pipelines" ON public.pipelines
  FOR ALL USING (organization_id = get_user_organization_id(auth.uid()))
  WITH CHECK (organization_id = get_user_organization_id(auth.uid()));

-- Pipeline stages
CREATE POLICY "Users can view organization pipeline stages" ON public.pipeline_stages
  FOR SELECT USING (is_active = true AND pipeline_id IN (
    SELECT id FROM pipelines WHERE organization_id = get_user_organization_id(auth.uid()) AND is_active = true
  ));

CREATE POLICY "Users can manage organization pipeline stages" ON public.pipeline_stages
  FOR ALL USING (pipeline_id IN (SELECT id FROM pipelines WHERE organization_id = get_user_organization_id(auth.uid())))
  WITH CHECK (pipeline_id IN (SELECT id FROM pipelines WHERE organization_id = get_user_organization_id(auth.uid())));

-- Leads
CREATE POLICY "Authenticated users can view organization leads" ON public.leads
  FOR SELECT USING (auth.uid() IS NOT NULL AND organization_id = get_user_organization_id(auth.uid()) 
    AND (seller_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Authenticated users can create leads in their organization" ON public.leads
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND organization_id = get_user_organization_id(auth.uid())
    AND seller_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND created_by IN (SELECT id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "Authenticated users can update leads they have access to" ON public.leads
  FOR UPDATE USING (auth.uid() IS NOT NULL AND can_user_update_lead(id, auth.uid()));

CREATE POLICY "Admins can delete organization leads" ON public.leads
  FOR DELETE USING (auth.uid() IS NOT NULL AND organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'));

-- Lead sources
CREATE POLICY "Users can view organization lead sources" ON public.lead_sources
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Admins can manage organization lead sources" ON public.lead_sources
  FOR ALL USING (get_user_role(auth.uid()) = 'admin' AND organization_id = get_user_organization_id(auth.uid()))
  WITH CHECK (get_user_role(auth.uid()) = 'admin' AND organization_id = get_user_organization_id(auth.uid()));

-- Lead inbox
CREATE POLICY "Organization members can view lead inbox" ON public.lead_inbox
  FOR SELECT USING (lead_id IN (SELECT id FROM leads WHERE organization_id = get_user_organization_id(auth.uid())));

-- Lead assignment
CREATE POLICY "Organization members can view lead assignments" ON public.lead_assignment
  FOR SELECT USING (lead_id IN (SELECT id FROM leads WHERE organization_id = get_user_organization_id(auth.uid())));

-- Lead distribution settings
CREATE POLICY "Users can view organization distribution settings" ON public.lead_distribution_settings
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Admins can manage organization distribution settings" ON public.lead_distribution_settings
  FOR ALL USING (get_user_role(auth.uid()) = 'admin' AND organization_id = get_user_organization_id(auth.uid()))
  WITH CHECK (get_user_role(auth.uid()) = 'admin' AND organization_id = get_user_organization_id(auth.uid()));

-- Lead distribution users
CREATE POLICY "Users can view organization distribution users" ON public.lead_distribution_users
  FOR SELECT USING (distribution_setting_id IN (
    SELECT id FROM lead_distribution_settings WHERE organization_id = get_user_organization_id(auth.uid())
  ));

CREATE POLICY "Admins can manage organization distribution users" ON public.lead_distribution_users
  FOR ALL USING (get_user_role(auth.uid()) = 'admin' AND distribution_setting_id IN (
    SELECT id FROM lead_distribution_settings WHERE organization_id = get_user_organization_id(auth.uid())
  ))
  WITH CHECK (get_user_role(auth.uid()) = 'admin' AND distribution_setting_id IN (
    SELECT id FROM lead_distribution_settings WHERE organization_id = get_user_organization_id(auth.uid())
  ));

-- Lead distribution rules
CREATE POLICY "Users can view organization distribution rules" ON public.lead_distribution_rules
  FOR SELECT USING (distribution_setting_id IN (
    SELECT id FROM lead_distribution_settings WHERE organization_id = get_user_organization_id(auth.uid())
  ));

CREATE POLICY "Admins can manage organization distribution rules" ON public.lead_distribution_rules
  FOR ALL USING (get_user_role(auth.uid()) = 'admin' AND distribution_setting_id IN (
    SELECT id FROM lead_distribution_settings WHERE organization_id = get_user_organization_id(auth.uid())
  ))
  WITH CHECK (get_user_role(auth.uid()) = 'admin' AND distribution_setting_id IN (
    SELECT id FROM lead_distribution_settings WHERE organization_id = get_user_organization_id(auth.uid())
  ));

-- Lead distribution state
CREATE POLICY "Organization members can manage distribution state" ON public.lead_distribution_state
  FOR ALL USING (distribution_setting_id IN (
    SELECT id FROM lead_distribution_settings WHERE organization_id = get_user_organization_id(auth.uid())
  ));

-- Lead distribution audit
CREATE POLICY "Admins can view distribution audit" ON public.lead_distribution_audit
  FOR SELECT USING (has_role(auth.uid(), 'admin'));

-- Tasks
CREATE POLICY "Usuários podem ver tarefas da organização" ON public.tasks
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid())
    AND (responsavel_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) OR get_user_role(auth.uid()) = 'admin'));

CREATE POLICY "Usuários podem criar tarefas na organização" ON public.tasks
  FOR INSERT WITH CHECK (organization_id = get_user_organization_id(auth.uid())
    AND responsavel_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "Usuários podem atualizar suas tarefas" ON public.tasks
  FOR UPDATE USING (organization_id = get_user_organization_id(auth.uid())
    AND (responsavel_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) OR get_user_role(auth.uid()) = 'admin'));

CREATE POLICY "Admins podem deletar tarefas da organização" ON public.tasks
  FOR DELETE USING (organization_id = get_user_organization_id(auth.uid()) AND get_user_role(auth.uid()) = 'admin');

-- Vehicles
CREATE POLICY "Organization members can view vehicles" ON public.vehicles
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Sellers can create organization vehicles" ON public.vehicles
  FOR INSERT WITH CHECK (organization_id = get_user_organization_id(auth.uid())
    AND created_by IN (SELECT id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "Admins can manage organization vehicles" ON public.vehicles
  FOR ALL USING (get_user_role(auth.uid()) = 'admin' AND organization_id = get_user_organization_id(auth.uid()));

-- Prospects
CREATE POLICY "Users can view prospects from their organization" ON public.prospects
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Users can insert prospects in their organization" ON public.prospects
  FOR INSERT WITH CHECK (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Users can update prospects in their organization" ON public.prospects
  FOR UPDATE USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Users can delete prospects in their organization" ON public.prospects
  FOR DELETE USING (organization_id = get_user_organization_id(auth.uid()));

-- WhatsApp integrations
CREATE POLICY "Only admins can view whatsapp integrations" ON public.whatsapp_integrations
  FOR SELECT USING (has_role(auth.uid(), 'admin') AND organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Admins can manage organization whatsapp integrations" ON public.whatsapp_integrations
  FOR ALL USING (get_user_role(auth.uid()) = 'admin' AND organization_id = get_user_organization_id(auth.uid()))
  WITH CHECK (get_user_role(auth.uid()) = 'admin' AND organization_id = get_user_organization_id(auth.uid()));

-- Meta integrations
CREATE POLICY "Users can view meta integrations" ON public.meta_integrations
  FOR SELECT USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Admins can manage meta integrations" ON public.meta_integrations
  FOR ALL USING (has_role(auth.uid(), 'admin') AND organization_id = get_user_organization_id(auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin') AND organization_id = get_user_organization_id(auth.uid()));

-- Meta events log
CREATE POLICY "Admins can view meta events log" ON public.meta_events_log
  FOR SELECT USING (has_role(auth.uid(), 'admin') AND organization_id = get_user_organization_id(auth.uid()));

-- =============================================================
-- CRIAR STORAGE BUCKET
-- =============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas de storage para avatares
CREATE POLICY "Avatar images are publicly accessible" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own avatar" ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- =============================================================
-- MIGRAÇÃO COMPLETA!
-- =============================================================
