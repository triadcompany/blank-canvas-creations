
-- Drop old RLS policies that depend on auth.uid() (which is null with Clerk)
DROP POLICY IF EXISTS "Users can view automations in their org" ON public.automations;
DROP POLICY IF EXISTS "Admins can insert automations" ON public.automations;
DROP POLICY IF EXISTS "Admins can update automations" ON public.automations;
DROP POLICY IF EXISTS "Admins can delete automations" ON public.automations;

-- Create new permissive policies (auth is handled by Clerk at the app layer)
-- Organization isolation is enforced in application code via profile.organization_id
CREATE POLICY "Allow all operations on automations"
ON public.automations FOR ALL
USING (true)
WITH CHECK (true);

-- Do the same for automation_logs
DROP POLICY IF EXISTS "Users can view logs in their org" ON public.automation_logs;
DROP POLICY IF EXISTS "System can insert logs" ON public.automation_logs;

CREATE POLICY "Allow all operations on automation_logs"
ON public.automation_logs FOR ALL
USING (true)
WITH CHECK (true);
