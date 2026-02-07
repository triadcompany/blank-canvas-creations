-- Fix can_user_update_lead function to correctly check user role
CREATE OR REPLACE FUNCTION public.can_user_update_lead(lead_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
      OR has_role(user_id, 'admin'::app_role)
    )
  );
$$;