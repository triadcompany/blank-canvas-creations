-- Reset conversation names polluted by outbound pushName.
-- Heuristic: any 1:1 contact_name that appears in 3+ conversations within the
-- same (organization_id, instance_name) and was sourced from "whatsapp" is
-- almost certainly the org owner's own profile name leaking from outbound
-- messages. Clear it so the next inbound message rewrites it correctly.
WITH polluted AS (
  SELECT organization_id, instance_name, contact_name
  FROM public.conversations
  WHERE is_group = false
    AND contact_name IS NOT NULL
    AND contact_name <> ''
    AND COALESCE(contact_name_source, 'whatsapp') = 'whatsapp'
  GROUP BY organization_id, instance_name, contact_name
  HAVING COUNT(*) >= 3
)
UPDATE public.conversations c
SET contact_name = NULL,
    contact_name_source = NULL
FROM polluted p
WHERE c.organization_id = p.organization_id
  AND c.instance_name = p.instance_name
  AND c.contact_name = p.contact_name
  AND c.is_group = false;