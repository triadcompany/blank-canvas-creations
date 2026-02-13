
-- Fix routing state policies
DROP POLICY IF EXISTS "Admins can manage wa_routing_state" ON public.whatsapp_routing_state;
DROP POLICY IF EXISTS "Org members can view wa_routing_state" ON public.whatsapp_routing_state;
DROP POLICY IF EXISTS "Service role full access wa_routing_state" ON public.whatsapp_routing_state;

CREATE POLICY "Org members can view wa_routing_state"
ON public.whatsapp_routing_state
FOR SELECT
USING (true);

CREATE POLICY "Org members can manage wa_routing_state"
ON public.whatsapp_routing_state
FOR ALL
USING (true)
WITH CHECK (true);
