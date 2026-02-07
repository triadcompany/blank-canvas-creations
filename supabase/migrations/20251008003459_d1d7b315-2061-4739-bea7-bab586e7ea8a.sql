-- Consolidação de leads duplicados e garantia de unicidade por telefone

-- 1) Consolidar registros de lead_inbox apontando para leads duplicados
WITH duplicates AS (
  SELECT 
    id,
    phone,
    organization_id,
    ROW_NUMBER() OVER (
      PARTITION BY phone, organization_id 
      ORDER BY created_at ASC
    ) as rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY phone, organization_id 
      ORDER BY created_at ASC
    ) as keep_id
  FROM leads
  WHERE phone IS NOT NULL
)
UPDATE lead_inbox
SET lead_id = d.keep_id
FROM duplicates d
WHERE lead_inbox.lead_id = d.id
  AND d.rn > 1;

-- 2) Consolidar registros de tasks apontando para leads duplicados
WITH duplicates AS (
  SELECT 
    id,
    phone,
    organization_id,
    ROW_NUMBER() OVER (
      PARTITION BY phone, organization_id 
      ORDER BY created_at ASC
    ) as rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY phone, organization_id 
      ORDER BY created_at ASC
    ) as keep_id
  FROM leads
  WHERE phone IS NOT NULL
)
UPDATE tasks
SET lead_id = d.keep_id
FROM duplicates d
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
    ) as rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY phone, organization_id 
      ORDER BY created_at ASC
    ) as keep_id
  FROM leads
  WHERE phone IS NOT NULL
)
DELETE FROM lead_assignment
WHERE lead_id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- 4) Agora remover os leads duplicados (mantendo o mais antigo)
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