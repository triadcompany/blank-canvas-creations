
-- Add column for profile picture cache TTL
ALTER TABLE public.conversations 
  ADD COLUMN IF NOT EXISTS profile_picture_updated_at timestamptz;

-- Add contact_name_source to track if name was manually edited
ALTER TABLE public.conversations 
  ADD COLUMN IF NOT EXISTS contact_name_source text DEFAULT 'whatsapp';
