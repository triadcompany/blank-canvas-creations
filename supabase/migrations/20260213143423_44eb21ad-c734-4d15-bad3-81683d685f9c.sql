
-- Fix whatsapp_routing_settings policies
DROP POLICY IF EXISTS "Admins can manage wa_routing_settings" ON public.whatsapp_routing_settings;
DROP POLICY IF EXISTS "Org members can view wa_routing_settings" ON public.whatsapp_routing_settings;
DROP POLICY IF EXISTS "Service role full access wa_routing_settings" ON public.whatsapp_routing_settings;

CREATE POLICY "Anyone can read wa_routing_settings"
ON public.whatsapp_routing_settings FOR SELECT USING (true);

CREATE POLICY "Anyone can write wa_routing_settings"
ON public.whatsapp_routing_settings FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update wa_routing_settings"
ON public.whatsapp_routing_settings FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete wa_routing_settings"
ON public.whatsapp_routing_settings FOR DELETE USING (true);

-- Fix whatsapp_routing_bucket_settings policies
DROP POLICY IF EXISTS "Admins can manage wa_routing_bucket_settings" ON public.whatsapp_routing_bucket_settings;
DROP POLICY IF EXISTS "Org members can view wa_routing_bucket_settings" ON public.whatsapp_routing_bucket_settings;
DROP POLICY IF EXISTS "Service role full access wa_routing_bucket_settings" ON public.whatsapp_routing_bucket_settings;
DROP POLICY IF EXISTS "Org members can manage wa_routing_bucket_settings" ON public.whatsapp_routing_bucket_settings;

CREATE POLICY "Anyone can read wa_routing_bucket" 
ON public.whatsapp_routing_bucket_settings FOR SELECT USING (true);

CREATE POLICY "Anyone can write wa_routing_bucket"
ON public.whatsapp_routing_bucket_settings FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update wa_routing_bucket"
ON public.whatsapp_routing_bucket_settings FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete wa_routing_bucket"
ON public.whatsapp_routing_bucket_settings FOR DELETE USING (true);
