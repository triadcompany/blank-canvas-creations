-- Migrar estágios existentes para uma pipeline padrão
-- Primeiro, criar uma pipeline padrão para organizações que têm usuários mas não têm pipelines
INSERT INTO public.pipelines (name, description, is_default, organization_id, created_by)
SELECT DISTINCT 
  'Pipeline Principal' as name,
  'Pipeline padrão do sistema' as description,
  true as is_default,
  p.organization_id,
  p.id
FROM profiles p
WHERE p.organization_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM pipelines 
  WHERE organization_id = p.organization_id
);

-- Associar estágios existentes às pipelines padrão de suas organizações
UPDATE pipeline_stages 
SET pipeline_id = (
  SELECT pip.id 
  FROM pipelines pip
  JOIN profiles p ON pip.organization_id = p.organization_id
  WHERE p.id = pipeline_stages.created_by
  AND pip.is_default = true
  LIMIT 1
)
WHERE pipeline_id IS NULL;