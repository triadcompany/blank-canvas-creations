
-- Add automation_id column to broadcast_campaigns
ALTER TABLE public.broadcast_campaigns
ADD COLUMN automation_id UUID REFERENCES public.automations(id) ON DELETE SET NULL DEFAULT NULL;

-- Add enable_automation flag
ALTER TABLE public.broadcast_campaigns
ADD COLUMN enable_automation BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.broadcast_campaigns.automation_id IS 'Optional automation to trigger after each message is sent';
COMMENT ON COLUMN public.broadcast_campaigns.enable_automation IS 'Whether to trigger the linked automation after sending';
