-- Garantir que usuários possam ver seus próprios roles
-- Remover policies antigas que podem estar bloqueando
DROP POLICY IF EXISTS "Users can view their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view organization roles" ON public.user_roles;

-- Criar policy para usuários verem seu próprio role
CREATE POLICY "Users can view their own role"
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Criar policy para admins verem roles da organização
CREATE POLICY "Admins can view organization roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() 
    AND ur.role = 'admin'
    AND ur.organization_id = user_roles.organization_id
  )
);