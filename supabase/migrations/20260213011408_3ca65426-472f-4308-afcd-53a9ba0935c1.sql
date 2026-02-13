
-- Add is_system column to automations table
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS is_system boolean DEFAULT false;
