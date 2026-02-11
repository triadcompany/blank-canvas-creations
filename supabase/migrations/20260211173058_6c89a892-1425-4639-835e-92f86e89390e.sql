-- Add assigned_to column to leads table (references profiles, matching seller_id pattern)
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS assigned_to UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';