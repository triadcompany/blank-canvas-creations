
-- Migrate existing inbound whatsapp_messages to conversations table
INSERT INTO conversations (organization_id, instance_name, contact_phone, last_message_at, unread_count, assigned_to, created_at)
SELECT 
  wm.organization_id,
  COALESCE(wm.instance_name, 'default'),
  wm.phone,
  MAX(wm.created_at)::timestamptz,
  0,
  NULL,
  MIN(wm.created_at)::timestamptz
FROM whatsapp_messages wm
WHERE wm.direction = 'inbound'
  AND wm.phone NOT LIKE '%@g.us'
  AND wm.organization_id IS NOT NULL
GROUP BY wm.organization_id, COALESCE(wm.instance_name, 'default'), wm.phone
ON CONFLICT DO NOTHING;

-- Migrate messages (inbound + outbound) to messages table
INSERT INTO messages (organization_id, conversation_id, direction, body, created_at)
SELECT 
  wm.organization_id,
  c.id,
  wm.direction,
  wm.message_text,
  wm.created_at
FROM whatsapp_messages wm
JOIN conversations c 
  ON c.organization_id = wm.organization_id 
  AND c.instance_name = COALESCE(wm.instance_name, 'default')
  AND c.contact_phone = wm.phone
WHERE wm.phone NOT LIKE '%@g.us'
  AND wm.organization_id IS NOT NULL
  AND wm.message_text IS NOT NULL;
