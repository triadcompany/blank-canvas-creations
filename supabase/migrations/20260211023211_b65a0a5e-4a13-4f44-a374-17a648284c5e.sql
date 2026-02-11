
-- Add channel column to conversations (default 'whatsapp' for backward compat)
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';
CREATE INDEX IF NOT EXISTS idx_conversations_channel ON public.conversations(channel);

-- Add channel column to messages
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';

-- Create social_integrations table
CREATE TABLE public.social_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'instagram',
  page_id text NOT NULL,
  ig_business_account_id text NOT NULL,
  ig_username text,
  ig_profile_picture_url text,
  page_name text,
  page_access_token text NOT NULL,
  token_expires_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  connected_by uuid REFERENCES auth.users(id),
  connected_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indices
CREATE UNIQUE INDEX idx_social_integrations_org_platform ON public.social_integrations(organization_id, platform);
CREATE INDEX idx_social_integrations_page_id ON public.social_integrations(page_id);
CREATE INDEX idx_social_integrations_ig_account ON public.social_integrations(ig_business_account_id);

-- RLS
ALTER TABLE public.social_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org social integrations"
  ON public.social_integrations FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage social integrations"
  ON public.social_integrations FOR ALL
  USING (organization_id IN (
    SELECT p.organization_id FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE p.user_id = auth.uid() AND ur.role = 'admin'
  ));

-- Create social_webhook_logs table
CREATE TABLE public.social_webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  platform text DEFAULT 'instagram',
  page_id text,
  event_type text,
  payload jsonb,
  auth_status text DEFAULT 'ok',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.social_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view social webhook logs"
  ON public.social_webhook_logs FOR SELECT
  USING (organization_id IN (
    SELECT p.organization_id FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE p.user_id = auth.uid() AND ur.role = 'admin'
  ));

-- Trigger for updated_at on social_integrations
CREATE TRIGGER update_social_integrations_updated_at
  BEFORE UPDATE ON public.social_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
