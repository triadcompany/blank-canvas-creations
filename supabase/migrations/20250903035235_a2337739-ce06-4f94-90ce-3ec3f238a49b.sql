-- Primeiro, encontrar um pipeline padrão para associar os estágios órfãos
-- Vamos usar o primeiro pipeline disponível como referência
WITH default_pipeline AS (
  SELECT id, created_by FROM pipelines ORDER BY created_at LIMIT 1
)
UPDATE public.pipeline_stages 
SET 
  pipeline_id = (SELECT id FROM default_pipeline),
  created_by = (SELECT created_by FROM default_pipeline)
WHERE pipeline_id IS NULL;

-- Agora tornar a coluna NOT NULL
ALTER TABLE public.pipeline_stages 
ALTER COLUMN created_by SET NOT NULL;

-- Criar política correta para pipeline_stages
DROP POLICY IF EXISTS "Users can manage organization pipeline stages" ON public.pipeline_stages;

CREATE POLICY "Users can manage organization pipeline stages" 
ON public.pipeline_stages 
FOR ALL 
USING (
  pipeline_id IN (
    SELECT id FROM public.pipelines 
    WHERE organization_id = get_user_organization_id(auth.uid())
  )
)
WITH CHECK (
  pipeline_id IN (
    SELECT id FROM public.pipelines 
    WHERE organization_id = get_user_organization_id(auth.uid())
  )
);