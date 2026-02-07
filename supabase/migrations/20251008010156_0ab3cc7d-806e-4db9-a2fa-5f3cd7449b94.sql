-- Adicionar campo whatsapp_e164 na tabela profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS whatsapp_e164 text;

-- Adicionar campos de configuração Evolution na tabela whatsapp_integrations
ALTER TABLE whatsapp_integrations 
  ADD COLUMN IF NOT EXISTS evolution_instance_id text,
  ADD COLUMN IF NOT EXISTS evolution_api_key text,
  ADD COLUMN IF NOT EXISTS n8n_webhook_evolution_notify text;

-- Comentários para documentação
COMMENT ON COLUMN profiles.whatsapp_e164 IS 'WhatsApp pessoal do usuário no formato E.164 para receber notificações';
COMMENT ON COLUMN whatsapp_integrations.evolution_instance_id IS 'ID da instância Evolution API da organização';
COMMENT ON COLUMN whatsapp_integrations.evolution_api_key IS 'API Key da Evolution API';
COMMENT ON COLUMN whatsapp_integrations.n8n_webhook_evolution_notify IS 'Webhook do n8n para enviar notificações via Evolution';