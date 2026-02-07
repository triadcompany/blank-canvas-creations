-- Verificar e corrigir política de DELETE para admins na tabela leads

-- Remover política existente se houver problema
DROP POLICY IF EXISTS "Authenticated admins can delete leads in their organization" ON public.leads;

-- Criar política atualizada de DELETE para admins
CREATE POLICY "Admins can delete organization leads"
ON public.leads
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL 
  AND organization_id = get_user_organization_id(auth.uid())
  AND has_role(auth.uid(), 'admin'::app_role)
);

-- Garantir que a função has_role existe e está correta
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;