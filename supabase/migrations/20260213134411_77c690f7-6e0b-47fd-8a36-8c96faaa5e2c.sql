
-- Add response tracking columns to broadcast_recipients
ALTER TABLE public.broadcast_recipients 
  ADD COLUMN IF NOT EXISTS response_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS response_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS response_message_id text NULL;

-- Add response_window_hours to broadcast_campaigns
ALTER TABLE public.broadcast_campaigns 
  ADD COLUMN IF NOT EXISTS response_window_hours int NOT NULL DEFAULT 24;

-- Rename automation columns for clarity (selected_automation_id)
-- The column automation_id already exists, and enable_automation already exists. Good.

-- Add indexes for efficient response matching
CREATE INDEX IF NOT EXISTS idx_recipients_phone_pending 
  ON public.broadcast_recipients(organization_id, phone, response_received, sent_at DESC)
  WHERE status IN ('sent', 'delivered', 'read') AND response_received = false;

CREATE INDEX IF NOT EXISTS idx_recipients_org_campaign 
  ON public.broadcast_recipients(organization_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_recipients_status 
  ON public.broadcast_recipients(organization_id, status);
