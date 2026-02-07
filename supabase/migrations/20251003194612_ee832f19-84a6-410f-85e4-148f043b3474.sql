-- Corrigir recursão infinita nas policies de user_roles
-- Remover policies com recursão
DROP POLICY IF EXISTS "Admins can view organization roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage organization roles" ON public.user_roles;

-- Recriar policy para admins verem roles da organização usando security definer function
CREATE POLICY "Admins can view organization roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  AND organization_id = get_user_organization_id(auth.uid())
);

-- Recriar policy para admins gerenciarem roles usando security definer function
CREATE POLICY "Admins can manage organization roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  AND organization_id = get_user_organization_id(auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  AND organization_id = get_user_organization_id(auth.uid())
);