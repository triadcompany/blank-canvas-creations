-- Criar tabela de pipelines
CREATE TABLE public.pipelines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  organization_id UUID,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para pipelines
CREATE POLICY "Users can view organization pipelines" 
ON public.pipelines 
FOR SELECT 
USING (
  organization_id = get_user_organization_id(auth.uid()) 
  AND is_active = true
);

CREATE POLICY "Users can manage organization pipelines" 
ON public.pipelines 
FOR ALL 
USING (organization_id = get_user_organization_id(auth.uid()))
WITH CHECK (organization_id = get_user_organization_id(auth.uid()));

-- Adicionar coluna pipeline_id à tabela pipeline_stages
ALTER TABLE public.pipeline_stages 
ADD COLUMN pipeline_id UUID;

-- Atualizar políticas da pipeline_stages para considerar organização
DROP POLICY IF EXISTS "Everyone can view active pipeline stages" ON public.pipeline_stages;
DROP POLICY IF EXISTS "Users can manage pipeline stages" ON public.pipeline_stages;

-- Criar nova política para pipeline_stages considerando organização
CREATE POLICY "Users can view organization pipeline stages" 
ON public.pipeline_stages 
FOR SELECT 
USING (
  is_active = true 
  AND pipeline_id IN (
    SELECT id FROM public.pipelines 
    WHERE organization_id = get_user_organization_id(auth.uid()) 
    AND is_active = true
  )
);

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

-- Criar trigger para updated_at nas pipelines
CREATE TRIGGER update_pipelines_updated_at
BEFORE UPDATE ON public.pipelines
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();