-- =============================================
-- SISTEMA DE FOLLOW-UP AUTOMÁTICO
-- =============================================

-- Enum para status do follow-up
CREATE TYPE public.followup_status AS ENUM ('PENDENTE', 'ENVIADO', 'PULADO', 'FALHOU', 'CANCELADO');

-- Enum para quem enviou
CREATE TYPE public.followup_sent_by AS ENUM ('AUTO', 'MANUAL');

-- Enum para direção da mensagem
CREATE TYPE public.message_direction AS ENUM ('outbound', 'inbound');

-- Enum para canal de comunicação
CREATE TYPE public.message_channel AS ENUM ('whatsapp', 'email', 'sms');

-- =============================================
-- TABELA: followup_templates
-- Templates de mensagem com variáveis
-- =============================================
CREATE TABLE public.followup_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'geral',
    content TEXT NOT NULL,
    variables TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================
-- TABELA: followup_cadences
-- Presets de cadência (ex: D+0 2h, D+1, D+3)
-- =============================================
CREATE TABLE public.followup_cadences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    steps JSONB NOT NULL DEFAULT '[]',
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================
-- TABELA: followups
-- Cada follow-up agendado
-- =============================================
CREATE TABLE public.followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    assigned_to UUID NOT NULL,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    channel message_channel DEFAULT 'whatsapp',
    status followup_status DEFAULT 'PENDENTE',
    template_id UUID REFERENCES public.followup_templates(id) ON DELETE SET NULL,
    message_custom TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    sent_by followup_sent_by,
    result_tag TEXT,
    notes TEXT,
    cadence_id UUID REFERENCES public.followup_cadences(id) ON DELETE SET NULL,
    cadence_step INTEGER,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================
-- TABELA: message_logs
-- Histórico de todas as mensagens
-- =============================================
CREATE TABLE public.message_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    followup_id UUID REFERENCES public.followups(id) ON DELETE SET NULL,
    direction message_direction NOT NULL,
    channel message_channel NOT NULL,
    content TEXT NOT NULL,
    provider_message_id TEXT,
    status TEXT DEFAULT 'sent',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================
-- TABELA: whatsapp_config
-- Configuração da Evolution API
-- =============================================
CREATE TABLE public.whatsapp_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
    api_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    instance_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================
-- ÍNDICES PARA PERFORMANCE
-- =============================================
CREATE INDEX idx_followups_org_status ON public.followups(organization_id, status);
CREATE INDEX idx_followups_scheduled ON public.followups(scheduled_for) WHERE status = 'PENDENTE';
CREATE INDEX idx_followups_lead ON public.followups(lead_id);
CREATE INDEX idx_followups_assigned ON public.followups(assigned_to);
CREATE INDEX idx_message_logs_lead ON public.message_logs(lead_id);
CREATE INDEX idx_message_logs_followup ON public.message_logs(followup_id);
CREATE INDEX idx_templates_org ON public.followup_templates(organization_id);
CREATE INDEX idx_cadences_org ON public.followup_cadences(organization_id);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

-- followup_templates
ALTER TABLE public.followup_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view templates in their org"
ON public.followup_templates FOR SELECT
USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Admins can manage templates"
ON public.followup_templates FOR ALL
USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

-- followup_cadences
ALTER TABLE public.followup_cadences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view cadences in their org"
ON public.followup_cadences FOR SELECT
USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Admins can manage cadences"
ON public.followup_cadences FOR ALL
USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

-- followups
ALTER TABLE public.followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view followups in their org (admins all, sellers own)"
ON public.followups FOR SELECT
USING (
    organization_id = get_user_organization_id(auth.uid()) AND (
        has_role(auth.uid(), 'admin'::app_role) OR
        assigned_to = (SELECT id FROM profiles WHERE user_id = auth.uid())
    )
);

CREATE POLICY "Users can insert followups in their org"
ON public.followups FOR INSERT
WITH CHECK (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Users can update their followups or admins all"
ON public.followups FOR UPDATE
USING (
    organization_id = get_user_organization_id(auth.uid()) AND (
        has_role(auth.uid(), 'admin'::app_role) OR
        assigned_to = (SELECT id FROM profiles WHERE user_id = auth.uid())
    )
);

CREATE POLICY "Admins can delete followups"
ON public.followups FOR DELETE
USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

-- message_logs
ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view message logs in their org (admins all, sellers own leads)"
ON public.message_logs FOR SELECT
USING (
    organization_id = get_user_organization_id(auth.uid()) AND (
        has_role(auth.uid(), 'admin'::app_role) OR
        lead_id IN (SELECT id FROM leads WHERE seller_id = (SELECT id FROM profiles WHERE user_id = auth.uid()))
    )
);

CREATE POLICY "System can insert message logs"
ON public.message_logs FOR INSERT
WITH CHECK (organization_id = get_user_organization_id(auth.uid()));

-- whatsapp_config
ALTER TABLE public.whatsapp_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view whatsapp config in their org"
ON public.whatsapp_config FOR SELECT
USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Admins can manage whatsapp config"
ON public.whatsapp_config FOR ALL
USING (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (organization_id = get_user_organization_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

-- =============================================
-- FUNÇÃO: Cancelar follow-ups quando lead fecha
-- =============================================
CREATE OR REPLACE FUNCTION public.cancel_followups_on_lead_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    closed_stage_names TEXT[] := ARRAY['Fechado', 'Venda', 'Comprou', 'Perdido'];
    stage_name TEXT;
BEGIN
    -- Buscar nome do novo estágio
    SELECT name INTO stage_name FROM pipeline_stages WHERE id = NEW.stage_id;
    
    -- Se moveu para estágio de fechamento, cancelar follow-ups pendentes
    IF stage_name = ANY(closed_stage_names) THEN
        UPDATE followups
        SET status = 'CANCELADO', updated_at = now()
        WHERE lead_id = NEW.id AND status = 'PENDENTE';
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_cancel_followups_on_lead_close
AFTER UPDATE OF stage_id ON public.leads
FOR EACH ROW
WHEN (OLD.stage_id IS DISTINCT FROM NEW.stage_id)
EXECUTE FUNCTION public.cancel_followups_on_lead_close();

-- =============================================
-- FUNÇÃO: Aplicar cadência a um lead
-- =============================================
CREATE OR REPLACE FUNCTION public.apply_cadence_to_lead(
    p_lead_id UUID,
    p_cadence_id UUID,
    p_assigned_to UUID,
    p_created_by UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id UUID;
    v_steps JSONB;
    v_step JSONB;
    v_step_count INTEGER := 0;
    v_base_time TIMESTAMP WITH TIME ZONE := now();
    v_scheduled_time TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Buscar organização do lead
    SELECT organization_id INTO v_org_id FROM leads WHERE id = p_lead_id;
    
    -- Buscar steps da cadência
    SELECT steps INTO v_steps FROM followup_cadences WHERE id = p_cadence_id;
    
    -- Iterar sobre os steps e criar follow-ups
    FOR v_step IN SELECT * FROM jsonb_array_elements(v_steps)
    LOOP
        v_step_count := v_step_count + 1;
        
        -- Calcular tempo agendado baseado no delay_hours
        v_scheduled_time := v_base_time + ((v_step->>'delay_hours')::INTEGER || ' hours')::INTERVAL;
        
        INSERT INTO followups (
            organization_id,
            lead_id,
            assigned_to,
            scheduled_for,
            channel,
            status,
            template_id,
            message_custom,
            cadence_id,
            cadence_step,
            created_by
        ) VALUES (
            v_org_id,
            p_lead_id,
            p_assigned_to,
            v_scheduled_time,
            COALESCE((v_step->>'channel')::message_channel, 'whatsapp'),
            'PENDENTE',
            (v_step->>'template_id')::UUID,
            v_step->>'message',
            p_cadence_id,
            v_step_count,
            p_created_by
        );
    END LOOP;
    
    RETURN v_step_count;
END;
$$;