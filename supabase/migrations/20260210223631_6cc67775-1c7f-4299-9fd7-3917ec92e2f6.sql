
-- Add lead_id column to conversations table (Option B)
ALTER TABLE public.conversations
  ADD COLUMN lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL;

-- Create index for fast lookups
CREATE INDEX idx_conversations_lead_id ON public.conversations(lead_id);

-- RLS: lead_id is just a column on conversations, existing RLS policies already cover access
