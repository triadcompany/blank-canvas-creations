-- Fix RLS policies for leads table to allow creation
-- Drop existing problematic policies
DROP POLICY IF EXISTS "Sellers can create organization leads" ON public.leads;
DROP POLICY IF EXISTS "Sellers can view organization leads" ON public.leads;
DROP POLICY IF EXISTS "Sellers can update organization leads" ON public.leads;
DROP POLICY IF EXISTS "Admins can view organization leads" ON public.leads;

-- Create new working policies
CREATE POLICY "Users can create leads in their organization" 
ON public.leads 
FOR INSERT 
WITH CHECK (
  organization_id = get_user_organization_id(auth.uid()) AND
  seller_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) AND
  created_by IN (SELECT id FROM profiles WHERE user_id = auth.uid())
);

CREATE POLICY "Users can view leads in their organization" 
ON public.leads 
FOR SELECT 
USING (
  organization_id = get_user_organization_id(auth.uid()) AND
  (seller_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) OR 
   get_user_role(auth.uid()) = 'admin'::app_role)
);

CREATE POLICY "Users can update leads in their organization" 
ON public.leads 
FOR UPDATE 
USING (
  organization_id = get_user_organization_id(auth.uid()) AND
  (seller_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) OR 
   get_user_role(auth.uid()) = 'admin'::app_role)
);

CREATE POLICY "Admins can delete leads in their organization" 
ON public.leads 
FOR DELETE 
USING (
  organization_id = get_user_organization_id(auth.uid()) AND
  get_user_role(auth.uid()) = 'admin'::app_role
);