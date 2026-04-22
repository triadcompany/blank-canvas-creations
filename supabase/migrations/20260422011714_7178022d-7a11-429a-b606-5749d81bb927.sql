-- Garante que cada instance_name (não-nula) só pode existir em UMA organização
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_integrations_instance_name_unique
  ON public.whatsapp_integrations (instance_name)
  WHERE instance_name IS NOT NULL;