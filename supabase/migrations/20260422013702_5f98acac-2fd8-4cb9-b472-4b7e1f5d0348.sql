
-- 1. Add column to track when WhatsApp was last disconnected (preserve history)
ALTER TABLE public.whatsapp_integrations
  ADD COLUMN IF NOT EXISTS last_disconnected_at TIMESTAMP WITH TIME ZONE;

-- 2. Ensure instance_name is globally unique (one instance per name across all orgs)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname='public' AND indexname='whatsapp_integrations_instance_name_unique'
  ) THEN
    CREATE UNIQUE INDEX whatsapp_integrations_instance_name_unique
      ON public.whatsapp_integrations (instance_name);
  END IF;
END $$;

-- 3. Ensure a phone_number can only be 'connected' in ONE organization at a time
--    (allows multiple disconnected/superseded rows for history)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname='public' AND indexname='whatsapp_integrations_connected_phone_unique'
  ) THEN
    CREATE UNIQUE INDEX whatsapp_integrations_connected_phone_unique
      ON public.whatsapp_integrations (phone_number)
      WHERE status = 'connected' AND phone_number IS NOT NULL;
  END IF;
END $$;
