-- Criar tabela para configurações de distribuição de leads
CREATE TABLE public.lead_distribution_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  is_auto_distribution_enabled boolean NOT NULL DEFAULT false,
  distribution_type text NOT NULL DEFAULT 'manual', -- 'manual', 'round_robin', 'specific_user'
  created_by uuid NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Criar tabela para regras de horário de distribuição
CREATE TABLE public.lead_distribution_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  distribution_setting_id uuid NOT NULL REFERENCES public.lead_distribution_settings(id) ON DELETE CASCADE,
  start_time time NOT NULL, -- horário de início (ex: 09:00)
  end_time time NOT NULL, -- horário de fim (ex: 18:00)
  assigned_user_id uuid NOT NULL, -- ID do profile do usuário designado
  days_of_week integer[] NOT NULL DEFAULT '{1,2,3,4,5}', -- 1=segunda, 7=domingo
  is_active boolean NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Criar tabela para lista de usuários na distribuição round robin
CREATE TABLE public.lead_distribution_users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  distribution_setting_id uuid NOT NULL REFERENCES public.lead_distribution_settings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, -- ID do profile do usuário
  is_active boolean NOT NULL DEFAULT true,
  order_position integer NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Criar tabela para controle de última distribuição (round robin)
CREATE TABLE public.lead_distribution_state (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  distribution_setting_id uuid NOT NULL REFERENCES public.lead_distribution_settings(id) ON DELETE CASCADE,
  last_assigned_user_id uuid,
  last_assignment_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_distribution_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_state ENABLE ROW LEVEL SECURITY;

-- Policies para lead_distribution_settings
CREATE POLICY "Admins can manage organization distribution settings" 
ON public.lead_distribution_settings 
FOR ALL 
USING ((get_user_role(auth.uid()) = 'admin'::app_role) AND (organization_id = get_user_organization_id(auth.uid())))
WITH CHECK ((get_user_role(auth.uid()) = 'admin'::app_role) AND (organization_id = get_user_organization_id(auth.uid())));

CREATE POLICY "Users can view organization distribution settings" 
ON public.lead_distribution_settings 
FOR SELECT 
USING (organization_id = get_user_organization_id(auth.uid()));

-- Policies para lead_distribution_rules
CREATE POLICY "Admins can manage organization distribution rules" 
ON public.lead_distribution_rules 
FOR ALL 
USING ((get_user_role(auth.uid()) = 'admin'::app_role) AND (distribution_setting_id IN (
  SELECT id FROM public.lead_distribution_settings 
  WHERE organization_id = get_user_organization_id(auth.uid())
)))
WITH CHECK ((get_user_role(auth.uid()) = 'admin'::app_role) AND (distribution_setting_id IN (
  SELECT id FROM public.lead_distribution_settings 
  WHERE organization_id = get_user_organization_id(auth.uid())
)));

CREATE POLICY "Users can view organization distribution rules" 
ON public.lead_distribution_rules 
FOR SELECT 
USING (distribution_setting_id IN (
  SELECT id FROM public.lead_distribution_settings 
  WHERE organization_id = get_user_organization_id(auth.uid())
));

-- Policies para lead_distribution_users
CREATE POLICY "Admins can manage organization distribution users" 
ON public.lead_distribution_users 
FOR ALL 
USING ((get_user_role(auth.uid()) = 'admin'::app_role) AND (distribution_setting_id IN (
  SELECT id FROM public.lead_distribution_settings 
  WHERE organization_id = get_user_organization_id(auth.uid())
)))
WITH CHECK ((get_user_role(auth.uid()) = 'admin'::app_role) AND (distribution_setting_id IN (
  SELECT id FROM public.lead_distribution_settings 
  WHERE organization_id = get_user_organization_id(auth.uid())
)));

CREATE POLICY "Users can view organization distribution users" 
ON public.lead_distribution_users 
FOR SELECT 
USING (distribution_setting_id IN (
  SELECT id FROM public.lead_distribution_settings 
  WHERE organization_id = get_user_organization_id(auth.uid())
));

-- Policies para lead_distribution_state
CREATE POLICY "System can manage distribution state" 
ON public.lead_distribution_state 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Triggers para updated_at
CREATE TRIGGER update_lead_distribution_settings_updated_at
BEFORE UPDATE ON public.lead_distribution_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_lead_distribution_rules_updated_at
BEFORE UPDATE ON public.lead_distribution_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_lead_distribution_state_updated_at
BEFORE UPDATE ON public.lead_distribution_state
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();