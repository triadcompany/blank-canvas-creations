-- Adicionar um token único para cada organização WhatsApp
ALTER TABLE public.whatsapp_integrations 
ADD COLUMN webhook_token TEXT UNIQUE DEFAULT gen_random_uuid()::text;

-- Atualizar registros existentes que podem não ter token
UPDATE public.whatsapp_integrations 
SET webhook_token = gen_random_uuid()::text 
WHERE webhook_token IS NULL;