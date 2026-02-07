-- Executar a função que cria pipeline padrão para organizações existentes que não têm
SELECT create_default_pipeline_for_existing_orgs();

-- Verificar se há organizações sem pipeline
SELECT 
  o.id as org_id,
  o.name as org_name,
  COUNT(p.id) as pipeline_count
FROM organizations o
LEFT JOIN pipelines p ON p.organization_id = o.id AND p.is_active = true
WHERE o.is_active = true
GROUP BY o.id, o.name
HAVING COUNT(p.id) = 0;