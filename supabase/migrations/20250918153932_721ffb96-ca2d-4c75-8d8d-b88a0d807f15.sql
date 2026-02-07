-- Add price column to leads table
ALTER TABLE public.leads 
ADD COLUMN price TEXT;