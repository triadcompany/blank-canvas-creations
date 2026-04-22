-- Limpar contact_name/group_name de conversas de grupo que foram contaminadas
-- pelo pushName de participantes. Usa fallback "Grupo (xxxx)" até obtermos o
-- nome real do grupo via subject/groups.upsert.
UPDATE public.conversations
SET
  contact_name = 'Grupo (' || RIGHT(contact_phone, 4) || ')',
  group_name = NULL,
  contact_name_source = 'group_fallback'
WHERE is_group = true
  AND (contact_name_source = 'whatsapp' OR contact_name_source IS NULL);