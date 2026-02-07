-- Primeiro, atualizar os registros com created_by NULL
-- Usar o primeiro admin de cada organização como created_by padrão
UPDATE public.pipeline_stages 
SET created_by = (
  SELECT p.id 
  FROM profiles p
  JOIN pipelines pip ON pip.organization_id = p.organization_id
  WHERE pip.id = pipeline_stages.pipeline_id
  AND p.role = 'admin'
  LIMIT 1
)
WHERE created_by IS NULL;

-- Se ainda houver registros NULL, usar qualquer usuário da organização
UPDATE public.pipeline_stages 
SET created_by = (
  SELECT p.id 
  FROM profiles p
  JOIN pipelines pip ON pip.organization_id = p.organization_id
  WHERE pip.id = pipeline_stages.pipeline_id
  LIMIT 1
)
WHERE created_by IS NULL;

-- Agora tornar a coluna NOT NULL
ALTER TABLE public.pipeline_stages 
ALTER COLUMN created_by SET NOT NULL;

-- Corrigir a política de pipeline_stages 
DROP POLICY IF EXISTS "Users can manage organization pipeline stages" ON public.pipeline_stages;

-- Criar política correta para pipeline_stages
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