
-- Add Evolution API columns to whatsapp_integrations
ALTER TABLE public.whatsapp_integrations 
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'evolution',
  ADD COLUMN IF NOT EXISTS evolution_base_url TEXT,
  ADD COLUMN IF NOT EXISTS instance_name TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'disconnected';

-- Create whatsapp_messages table for logging
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  automation_run_id UUID REFERENCES public.automation_runs(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound','outbound')),
  phone TEXT NOT NULL,
  message_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','read','failed')),
  external_message_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view messages" ON public.whatsapp_messages
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Service role manages messages" ON public.whatsapp_messages
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_whatsapp_messages_org ON public.whatsapp_messages (organization_id);
CREATE INDEX idx_whatsapp_messages_lead ON public.whatsapp_messages (lead_id);
CREATE INDEX idx_whatsapp_messages_phone ON public.whatsapp_messages (phone);
