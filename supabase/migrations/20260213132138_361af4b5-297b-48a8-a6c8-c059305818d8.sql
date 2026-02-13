
-- Fix whatsapp_integrations RLS to work with Clerk auth
-- Add a new SELECT policy using get_my_org_id() which supports Clerk headers

CREATE POLICY "Org members can view whatsapp config via clerk"
  ON public.whatsapp_integrations
  FOR SELECT
  USING (organization_id = public.get_my_org_id());
