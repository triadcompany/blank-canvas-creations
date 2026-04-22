-- Backfill group flag and reset polluted group names for existing conversations.
-- WhatsApp group JIDs are numeric strings of 17+ digits (often starting with 120363).
-- Individual numbers are at most 13 digits (country+area+number).
UPDATE public.conversations
SET
  is_group = true,
  contact_name = 'Grupo (' || RIGHT(contact_phone, 4) || ')',
  group_name = NULL,
  contact_name_source = 'group_fallback'
WHERE is_group IS DISTINCT FROM true
  AND contact_phone ~ '^[0-9]{15,}$';
