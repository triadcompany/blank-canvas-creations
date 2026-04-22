CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_name text NOT NULL UNIQUE,
  phone_number text,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','connecting','connected','error')),
  qr_code text,
  connected_at timestamptz,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,
  mirror_enabled boolean NOT NULL DEFAULT true,
  mirror_enabled_at timestamptz,
  evolution_api_key text,
  created_by_clerk_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_one_active_per_org
  ON public.whatsapp_connections(organization_id)
  WHERE status IN ('connected','connecting');

CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_org ON public.whatsapp_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_instance ON public.whatsapp_connections(instance_name);

-- Migrar dados antigos sem depender de coluna 'role' inexistente
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='whatsapp_integrations') THEN
    INSERT INTO public.whatsapp_connections (
      organization_id, instance_name, phone_number, status,
      qr_code, connected_at, last_disconnected_at, created_by_clerk_user_id, created_at, updated_at
    )
    SELECT
      wi.organization_id,
      COALESCE(wi.instance_name, 'autolead_' || replace(wi.organization_id::text,'-','') || '_legacy'),
      wi.phone_number,
      COALESCE(wi.status, 'disconnected'),
      wi.qr_code_data,
      wi.connected_at,
      wi.last_disconnected_at,
      'system'::text,
      COALESCE(wi.created_at, now()),
      COALESCE(wi.updated_at, now())
    FROM public.whatsapp_integrations wi
    ON CONFLICT (instance_name) DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.touch_whatsapp_connections_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_connections_updated_at ON public.whatsapp_connections;
CREATE TRIGGER trg_whatsapp_connections_updated_at
  BEFORE UPDATE ON public.whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_whatsapp_connections_updated_at();

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members view own org connection" ON public.whatsapp_connections;
CREATE POLICY "members view own org connection"
  ON public.whatsapp_connections FOR SELECT
  USING (organization_id = public.get_my_org_id());

DROP POLICY IF EXISTS "admins manage org connection" ON public.whatsapp_connections;
CREATE POLICY "admins manage org connection"
  ON public.whatsapp_connections FOR ALL
  USING (organization_id = public.get_my_org_id() AND public.get_my_role() = 'admin')
  WITH CHECK (organization_id = public.get_my_org_id() AND public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "service role all" ON public.whatsapp_connections;
CREATE POLICY "service role all"
  ON public.whatsapp_connections FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);