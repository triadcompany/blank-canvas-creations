
CREATE TABLE public.whatsapp_routing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text UNIQUE NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'round_robin',
  assign_on text NOT NULL DEFAULT 'first_message',
  only_roles jsonb NOT NULL DEFAULT '["seller","admin"]'::jsonb,
  business_hours_enabled boolean NOT NULL DEFAULT false,
  business_hours jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_routing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org routing settings"
ON public.whatsapp_routing_settings
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can insert their org routing settings"
ON public.whatsapp_routing_settings
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Users can update their org routing settings"
ON public.whatsapp_routing_settings
FOR UPDATE
TO authenticated
USING (true);
