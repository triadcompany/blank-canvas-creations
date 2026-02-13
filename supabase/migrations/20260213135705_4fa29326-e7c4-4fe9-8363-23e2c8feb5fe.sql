
-- Add buttons column to broadcast_campaigns for interactive messages
ALTER TABLE public.broadcast_campaigns
  ADD COLUMN IF NOT EXISTS buttons jsonb NULL;

-- Add inbound context columns to broadcast_recipients
ALTER TABLE public.broadcast_recipients
  ADD COLUMN IF NOT EXISTS inbound_text text NULL,
  ADD COLUMN IF NOT EXISTS inbound_button_value text NULL;

-- Update payload_type check to include 'interactive'
-- First drop existing check if any, then add new one
DO $$
BEGIN
  -- Try to drop existing check constraint on payload_type
  BEGIN
    ALTER TABLE public.broadcast_campaigns DROP CONSTRAINT IF EXISTS broadcast_campaigns_payload_type_check;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;
