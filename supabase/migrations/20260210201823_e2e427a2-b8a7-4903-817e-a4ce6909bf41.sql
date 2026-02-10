
-- 1) Add bucket columns to whatsapp_threads
ALTER TABLE public.whatsapp_threads
  ADD COLUMN IF NOT EXISTS routing_bucket text NOT NULL DEFAULT 'non_traffic',
  ADD COLUMN IF NOT EXISTS first_message_text text,
  ADD COLUMN IF NOT EXISTS first_message_at timestamptz;

-- 2) Rebuild whatsapp_routing_state to support per-bucket state
-- Drop old unique constraint and add composite unique
ALTER TABLE public.whatsapp_routing_state
  DROP CONSTRAINT IF EXISTS whatsapp_routing_state_organization_id_key;

ALTER TABLE public.whatsapp_routing_state
  ADD COLUMN IF NOT EXISTS bucket text NOT NULL DEFAULT 'non_traffic';

ALTER TABLE public.whatsapp_routing_state
  ADD CONSTRAINT whatsapp_routing_state_org_bucket_unique UNIQUE (organization_id, bucket);

-- 3) Add per-bucket config to whatsapp_routing_settings
ALTER TABLE public.whatsapp_routing_settings
  ADD COLUMN IF NOT EXISTS traffic_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS non_traffic_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS traffic_roles jsonb NOT NULL DEFAULT '["seller","admin"]'::jsonb,
  ADD COLUMN IF NOT EXISTS non_traffic_roles jsonb NOT NULL DEFAULT '["seller","admin"]'::jsonb;
