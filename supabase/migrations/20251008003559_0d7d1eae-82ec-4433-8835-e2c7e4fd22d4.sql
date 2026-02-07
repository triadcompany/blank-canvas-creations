-- Consolidação de leads duplicados e garantia de unicidade por telefone
-- Abordagem corrigida sem usar MIN(uuid)

-- 1) Consolidar registros de lead_inbox apontando para leads duplicados
WITH duplicates AS (
  SELECT 
    id,
    phone,
    organization_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY phone, organization_id 
      ORDER BY created_at ASC
    ) as rn
  FROM leads
  WHERE phone IS NOT NULL
),
keep_leads AS (
  SELECT DISTINCT ON (phone, organization_id)
    phone,
    organization_id,
    id as keep_id
  FROM duplicates
  WHERE rn = 1
)
UPDATE lead_inbox
SET lead_id = k.keep_id
FROM duplicates d
JOIN keep_leads k ON d.phone = k.phone AND d.organization_id = k.organization_id
WHERE lead_inbox.lead_id = d.id
  AND d.rn > 1;

-- 2) Consolidar registros de tasks apontando para leads duplicados
WITH duplicates AS (
  SELECT 
    id,
    phone,
    organization_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY phone, organization_id 
      ORDER BY created_at ASC
    ) as rn
  FROM leads
  WHERE phone IS NOT NULL
),
keep_leads AS (
  SELECT DISTINCT ON (phone, organization_id)
    phone,
    organization_id,
    id as keep_id
  FROM duplicates
  WHERE rn = 1
)
UPDATE tasks
SET lead_id = k.keep_id
FROM duplicates d
JOIN keep_leads k ON d.phone = k.phone AND d.organization_id = k.organization_id
WHERE tasks.lead_id = d.id
  AND d.rn > 1;

-- 3) Consolidar lead_assignment
WITH duplicates AS (
  SELECT 
    id,
    phone,
    organization_id,
    ROW_NUMBER() OVER (
      PARTITION BY phone, organization_id 
      ORDER BY created_at ASC
    ) as rn
  FROM leads
  WHERE phone IS NOT NULL
)
DELETE FROM lead_assignment
WHERE lead_id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- 4) Remover os leads duplicados (mantendo o mais antigo)
WITH duplicates AS (
  SELECT id, 
         ROW_NUMBER() OVER (
           PARTITION BY phone, organization_id 
           ORDER BY created_at ASC
         ) as rn
  FROM leads
  WHERE phone IS NOT NULL
)
DELETE FROM leads
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- 5) Adicionar índice único composto (phone + organization_id)
CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_org_unique 
  ON leads(phone, organization_id) 
  WHERE phone IS NOT NULL;

-- 6) Garantir que external_id em lead_inbox seja único
CREATE UNIQUE INDEX IF NOT EXISTS lead_inbox_external_id_unique 
  ON lead_inbox(external_id) 
  WHERE external_id IS NOT NULL;