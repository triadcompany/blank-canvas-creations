-- Remover a constraint UNIQUE incorreta na coluna position
ALTER TABLE public.pipeline_stages 
DROP CONSTRAINT IF EXISTS pipeline_stages_position_key;

-- Criar constraint UNIQUE composta correta para (pipeline_id, position)
-- Isso permite que cada pipeline tenha suas próprias posições 1, 2, 3, etc.
ALTER TABLE public.pipeline_stages 
ADD CONSTRAINT pipeline_stages_pipeline_position_unique 
UNIQUE (pipeline_id, position);

-- Verificar e corrigir posições duplicadas dentro do mesmo pipeline
-- Se houver conflitos, reordenar as posições
UPDATE public.pipeline_stages 
SET position = row_number() OVER (PARTITION BY pipeline_id ORDER BY created_at)
WHERE pipeline_id IS NOT NULL;