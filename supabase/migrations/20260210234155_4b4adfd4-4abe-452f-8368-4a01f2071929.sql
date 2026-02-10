
-- Add webhook_token column to whatsapp_integrations
-- Each org gets its own token, used to authenticate inbound webhooks
ALTER TABLE public.whatsapp_integrations 
ADD COLUMN IF NOT EXISTS webhook_token TEXT;

-- Add last_webhook_event_at and last_webhook_error for diagnostics
ALTER TABLE public.whatsapp_integrations 
ADD COLUMN IF NOT EXISTS last_webhook_event_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_webhook_error TEXT;

-- Add auth_status column to evolution_webhook_logs for pre-auth logging
ALTER TABLE public.evolution_webhook_logs 
ADD COLUMN IF NOT EXISTS auth_status TEXT;
