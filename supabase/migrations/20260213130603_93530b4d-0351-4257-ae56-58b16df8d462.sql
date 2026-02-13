
-- =============================================
-- Broadcast campaigns & recipients
-- =============================================

CREATE TABLE public.broadcast_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_by uuid NOT NULL,
  name text NOT NULL,
  instance_name text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused','completed','canceled')),
  payload_type text NOT NULL CHECK (payload_type IN ('text','image','audio')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.broadcast_campaigns(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  phone text NOT NULL,
  name text,
  variables jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
  sent_at timestamptz,
  error text,
  message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_bc_org_created ON public.broadcast_campaigns(organization_id, created_at DESC);
CREATE INDEX idx_br_campaign_status ON public.broadcast_recipients(campaign_id, status);
CREATE UNIQUE INDEX idx_br_campaign_phone ON public.broadcast_recipients(campaign_id, phone);

-- RLS
ALTER TABLE public.broadcast_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can manage broadcast_campaigns"
  ON public.broadcast_campaigns
  FOR ALL
  USING (organization_id = public.get_my_org_id())
  WITH CHECK (organization_id = public.get_my_org_id());

CREATE POLICY "Org members can manage broadcast_recipients"
  ON public.broadcast_recipients
  FOR ALL
  USING (organization_id = public.get_my_org_id())
  WITH CHECK (organization_id = public.get_my_org_id());
