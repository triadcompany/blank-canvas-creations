-- Corrigir as políticas RLS para permitir que vendedores atualizem leads
-- Remover a política atual de UPDATE que está muito restritiva
DROP POLICY IF EXISTS "Users can update leads in their organization" ON public.leads;

-- Criar nova política de UPDATE mais permissiva para vendedores
CREATE POLICY "Users can update their assigned leads"
ON public.leads
FOR UPDATE
USING (
  organization_id = get_user_organization_id(auth.uid()) 
  AND (
    -- Vendedores podem atualizar leads atribuídos a eles
    seller_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
    -- Admins podem atualizar qualquer lead da organização
    OR get_user_role(auth.uid()) = 'admin'
  )
);