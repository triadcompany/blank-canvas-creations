-- Primeiro, limpar registros duplicados mantendo apenas o mais recente para cada configuração
DELETE FROM lead_distribution_state 
WHERE id NOT IN (
  SELECT DISTINCT ON (distribution_setting_id) id
  FROM lead_distribution_state
  ORDER BY distribution_setting_id, last_assignment_at DESC NULLS LAST
);

-- Criar constraint única para evitar duplicatas
ALTER TABLE lead_distribution_state 
ADD CONSTRAINT unique_distribution_setting_state 
UNIQUE (distribution_setting_id);