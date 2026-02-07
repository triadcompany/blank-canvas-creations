-- Tabela de configuração de integração com Meta Pixel
CREATE TABLE public.meta_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Credenciais Meta
  pixel_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  
  -- Configurações de eventos PERSONALIZADOS
  track_lead_qualificado BOOLEAN DEFAULT true,           -- Estágio "Qualificado"
  track_lead_super_qualificado BOOLEAN DEFAULT true,     -- Estágio "Proposta Enviada"
  track_lead_comprou BOOLEAN DEFAULT true,               -- Estágio "Venda"
  track_lead_veio_loja BOOLEAN DEFAULT true,             -- Estágio "Agendado"
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  test_mode BOOLEAN DEFAULT false,
  
  -- Auditoria
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID NOT NULL REFERENCES public.profiles(id)
);

-- RLS Policies para meta_integrations
ALTER TABLE public.meta_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage meta integrations"
ON public.meta_integrations FOR ALL
USING (
  has_role(auth.uid(), 'admin'::app_role)
  AND organization_id = get_user_organization_id(auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  AND organization_id = get_user_organization_id(auth.uid())
);

CREATE POLICY "Users can view meta integrations"
ON public.meta_integrations FOR SELECT
USING (organization_id = get_user_organization_id(auth.uid()));

-- Indexes
CREATE INDEX idx_meta_integrations_org_id ON public.meta_integrations(organization_id);
CREATE INDEX idx_meta_integrations_active ON public.meta_integrations(is_active) WHERE is_active = true;

-- Trigger para updated_at
CREATE TRIGGER update_meta_integrations_updated_at
BEFORE UPDATE ON public.meta_integrations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela de log de eventos enviados para Meta (auditoria e debug)
CREATE TABLE public.meta_events_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  
  event_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_time BIGINT NOT NULL,
  
  payload JSONB NOT NULL,
  response JSONB,
  
  success BOOLEAN DEFAULT false,
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS para meta_events_log
ALTER TABLE public.meta_events_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view meta events log"
ON public.meta_events_log FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  AND organization_id = get_user_organization_id(auth.uid())
);

-- Indexes para meta_events_log
CREATE INDEX idx_meta_events_log_org_id ON public.meta_events_log(organization_id);
CREATE INDEX idx_meta_events_log_lead_id ON public.meta_events_log(lead_id);
CREATE INDEX idx_meta_events_log_created_at ON public.meta_events_log(created_at DESC);

-- Função para enviar eventos Meta quando lead muda de estágio
CREATE OR REPLACE FUNCTION notify_meta_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_name TEXT;
  stage_name TEXT;
BEGIN
  -- Apenas processar INSERT ou UPDATE de stage_id
  IF (TG_OP = 'UPDATE' AND OLD.stage_id IS NOT DISTINCT FROM NEW.stage_id) THEN
    RETURN NEW;
  END IF;
  
  -- Buscar nome do estágio
  SELECT name INTO stage_name
  FROM pipeline_stages
  WHERE id = NEW.stage_id;
  
  -- Mapeamento por nome do estágio (case-insensitive)
  IF stage_name ILIKE '%qualificado%' AND stage_name NOT ILIKE '%super%' AND stage_name NOT ILIKE '%proposta%' THEN
    event_name := 'Lead';
    
  ELSIF stage_name ILIKE '%proposta%' OR stage_name ILIKE '%proposta enviada%' THEN
    event_name := 'Lead_Super_Qualificado';
    
  ELSIF stage_name ILIKE '%venda%' OR stage_name ILIKE '%vendido%' OR stage_name ILIKE '%fechado%' THEN
    event_name := 'Purchase';
    
  ELSIF stage_name ILIKE '%agendado%' OR stage_name ILIKE '%agendamento%' THEN
    event_name := 'Lead_Veio_Loja';
    
  ELSE
    RETURN NEW; -- Não enviar evento para outros estágios
  END IF;
  
  -- Chamar edge function (async, não bloqueia)
  BEGIN
    PERFORM net.http_post(
      url := 'https://wjfndfamepbjjfggkcua.supabase.co/functions/v1/send-meta-event',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqZm5kZmFtZXBiampmZ2drY3VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4MzAxNTYsImV4cCI6MjA3MjQwNjE1Nn0.G2Rc8js-ZGyEWlr9si12fdcIjZggLgwmEeNhxTT97Zk'
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

-- Criar trigger na tabela leads
CREATE TRIGGER leads_meta_event_trigger
AFTER INSERT OR UPDATE OF stage_id ON public.leads
FOR EACH ROW
EXECUTE FUNCTION notify_meta_event();