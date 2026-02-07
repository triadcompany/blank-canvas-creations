-- Deletar registros órfãos que não têm pipeline_id válido
DELETE FROM public.pipeline_stages 
WHERE pipeline_id IS NULL OR pipeline_id NOT IN (SELECT id FROM public.pipelines);

-- Atualizar created_by usando o created_by da pipeline correspondente
UPDATE public.pipeline_stages 
SET created_by = (
  SELECT pip.created_by 
  FROM pipelines pip 
  WHERE pip.id = pipeline_stages.pipeline_id
)
WHERE created_by IS NULL;

-- Verificar se ainda há valores NULL
-- Se ainda houver, usar um valor padrão (primeiro profile encontrado)
UPDATE public.pipeline_stages 
SET created_by = (
  SELECT id FROM profiles LIMIT 1
)
WHERE created_by IS NULL;

-- Agora tornar a coluna NOT NULL
ALTER TABLE public.pipeline_stages 
ALTER COLUMN created_by SET NOT NULL;