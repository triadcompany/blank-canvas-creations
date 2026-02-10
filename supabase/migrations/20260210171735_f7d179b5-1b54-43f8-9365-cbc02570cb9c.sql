
-- Drop old columns that are no longer needed
ALTER TABLE public.whatsapp_integrations 
  DROP COLUMN IF EXISTS evolution_base_url,
  DROP COLUMN IF EXISTS created_by;

-- Add new columns
ALTER TABLE public.whatsapp_integrations
  ADD COLUMN IF NOT EXISTS qr_code_data TEXT,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

-- Ensure organization_id is unique (one integration per org)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_integrations_organization_id_unique'
  ) THEN
    ALTER TABLE public.whatsapp_integrations 
      ADD CONSTRAINT whatsapp_integrations_organization_id_unique UNIQUE (organization_id);
  END IF;
END $$;

-- Make instance_name NOT NULL with a default for existing rows
UPDATE public.whatsapp_integrations SET instance_name = 'default' WHERE instance_name IS NULL;
ALTER TABLE public.whatsapp_integrations ALTER COLUMN instance_name SET NOT NULL;

-- Ensure status has proper default
ALTER TABLE public.whatsapp_integrations ALTER COLUMN status SET DEFAULT 'disconnected';
