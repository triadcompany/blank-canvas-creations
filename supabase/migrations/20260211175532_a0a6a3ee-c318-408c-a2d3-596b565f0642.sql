-- FASE 3: Make seller_id nullable on leads table
ALTER TABLE public.leads ALTER COLUMN seller_id DROP NOT NULL;