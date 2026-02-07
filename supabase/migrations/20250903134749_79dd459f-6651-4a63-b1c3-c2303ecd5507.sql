-- Criar tabela para configurações WhatsApp por organização
CREATE TABLE public.whatsapp_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  webhook_url TEXT,
  api_key TEXT,
  phone_number TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID NOT NULL
);

-- Enable RLS
ALTER TABLE public.whatsapp_integrations ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para WhatsApp integrations
CREATE POLICY "Admins can manage organization whatsapp integrations" 
ON public.whatsapp_integrations 
FOR ALL 
USING (
  (get_user_role(auth.uid()) = 'admin'::app_role) 
  AND (organization_id = get_user_organization_id(auth.uid()))
)
WITH CHECK (
  (get_user_role(auth.uid()) = 'admin'::app_role) 
  AND (organization_id = get_user_organization_id(auth.uid()))
);

CREATE POLICY "Users can view organization whatsapp integrations" 
ON public.whatsapp_integrations 
FOR SELECT 
USING (organization_id = get_user_organization_id(auth.uid()));

-- Trigger para atualizar updated_at
CREATE TRIGGER update_whatsapp_integrations_updated_at
BEFORE UPDATE ON public.whatsapp_integrations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Index para melhor performance
CREATE INDEX idx_whatsapp_integrations_organization_id ON public.whatsapp_integrations(organization_id);
CREATE INDEX idx_whatsapp_integrations_phone_number ON public.whatsapp_integrations(phone_number);