-- Add test_mode and domain columns to meta_capi_settings
ALTER TABLE public.meta_capi_settings 
  ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS domain text;