
-- Fix event_dispatch_queue RLS: remove overly-permissive policies (service_role bypasses RLS automatically)
DROP POLICY IF EXISTS "Service role full access" ON public.event_dispatch_queue;
DROP POLICY IF EXISTS "Users can view their org queue" ON public.event_dispatch_queue;
