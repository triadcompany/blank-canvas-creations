-- Corrigir a política de pipeline_stages que tem nome de tabela errado
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

-- Adicionar também uma política específica para permitir acesso sem pipeline_id durante criação
CREATE POLICY "Users can create pipeline stages for their organization" 
ON public.pipeline_stages 
FOR INSERT 
WITH CHECK (
  created_by IN (
    SELECT id FROM public.profiles 
    WHERE user_id = auth.uid()
  )
);

-- Verificar se o campo created_by é obrigatório na tabela
ALTER TABLE public.pipeline_stages 
ALTER COLUMN created_by SET NOT NULL;