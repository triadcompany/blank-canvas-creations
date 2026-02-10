
-- Per-bucket routing configuration
CREATE TABLE IF NOT EXISTS public.whatsapp_routing_bucket_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('traffic', 'non_traffic')),
  enabled boolean NOT NULL DEFAULT true,
  mode text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'fixed_user')),
  auto_assign_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  fixed_user_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, bucket)
);

ALTER TABLE public.whatsapp_routing_bucket_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view bucket settings of their org"
  ON public.whatsapp_routing_bucket_settings
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT p.organization_id::text FROM public.profiles p WHERE p.clerk_user_id = auth.jwt()->>'sub'
    )
  );

CREATE POLICY "Admins can manage bucket settings"
  ON public.whatsapp_routing_bucket_settings
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT p.organization_id::text FROM public.profiles p
      JOIN public.user_roles ur ON ur.clerk_user_id = p.clerk_user_id AND ur.organization_id = p.organization_id
      WHERE p.clerk_user_id = auth.jwt()->>'sub' AND ur.role = 'admin'
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT p.organization_id::text FROM public.profiles p
      JOIN public.user_roles ur ON ur.clerk_user_id = p.clerk_user_id AND ur.organization_id = p.organization_id
      WHERE p.clerk_user_id = auth.jwt()->>'sub' AND ur.role = 'admin'
    )
  );
