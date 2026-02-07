-- Remover a constraint UNIQUE incorreta na coluna position
ALTER TABLE public.pipeline_stages 
DROP CONSTRAINT IF EXISTS pipeline_stages_position_key;

-- Primeiro, corrigir posições duplicadas usando CTE
WITH position_updates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (PARTITION BY pipeline_id ORDER BY created_at) as new_position
  FROM public.pipeline_stages 
  WHERE pipeline_id IS NOT NULL
)
UPDATE public.pipeline_stages 
SET position = position_updates.new_position
FROM position_updates
WHERE pipeline_stages.id = position_updates.id;

-- Agora criar constraint UNIQUE composta correta para (pipeline_id, position)
ALTER TABLE public.pipeline_stages 
ADD CONSTRAINT pipeline_stages_pipeline_position_unique 
UNIQUE (pipeline_id, position);