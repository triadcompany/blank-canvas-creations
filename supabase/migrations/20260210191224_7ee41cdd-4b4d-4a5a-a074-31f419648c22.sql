
-- Add engagement tracking columns to leads table
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_reply_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_inbound_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_inbound_message_text TEXT;

-- Add instance_name column to whatsapp_messages if not exists
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS instance_name TEXT;

-- Create index for phone lookup on leads
CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_organization_phone ON public.leads (organization_id, phone);

-- Create index for instance_name on whatsapp_integrations
CREATE INDEX IF NOT EXISTS idx_whatsapp_integrations_instance_name ON public.whatsapp_integrations (instance_name);
