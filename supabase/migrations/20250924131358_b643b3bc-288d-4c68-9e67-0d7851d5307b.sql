-- Remover política atual que pode estar causando problemas
DROP POLICY IF EXISTS "Users can update their assigned leads" ON public.leads;

-- Criar função security definer para verificar se usuário pode atualizar lead
CREATE OR REPLACE FUNCTION public.can_user_update_lead(lead_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM leads l
    JOIN profiles p ON p.user_id = user_id
    WHERE l.id = lead_id 
    AND l.organization_id = p.organization_id
    AND (
      -- Vendedor pode atualizar seus próprios leads
      l.seller_id = p.id
      -- Admin pode atualizar qualquer lead da organização
      OR p.role = 'admin'
    )
  );
$$;

-- Criar nova política usando a função security definer
CREATE POLICY "Users can update leads they have access to"
ON public.leads
FOR UPDATE
USING (can_user_update_lead(id, auth.uid()));

-- Também criar política para SELECT que seja mais robusta
DROP POLICY IF EXISTS "Users can view leads in their organization" ON public.leads;

CREATE POLICY "Users can view organization leads"
ON public.leads
FOR SELECT
USING (
  organization_id = get_user_organization_id(auth.uid())
  AND (
    seller_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
    OR get_user_role(auth.uid()) = 'admin'
  )
);