-- Atualizar políticas RLS para permitir que todos os usuários autenticados gerenciem pipeline stages
-- Remover política restrita a admins
DROP POLICY IF EXISTS "Admins can manage pipeline stages" ON public.pipeline_stages;

-- Criar nova política para permitir que usuários autenticados gerenciem stages
CREATE POLICY "Users can manage pipeline stages" 
ON public.pipeline_stages 
FOR ALL 
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);