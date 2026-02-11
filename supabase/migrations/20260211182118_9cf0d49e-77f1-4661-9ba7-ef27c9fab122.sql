
-- Drop restrictive policies that rely on auth.uid() (which is null with Clerk)
DROP POLICY IF EXISTS "Admins can manage lead sources" ON public.lead_sources;
DROP POLICY IF EXISTS "Users can view lead sources" ON public.lead_sources;

-- Create permissive policies matching the rest of the system
CREATE POLICY "Allow all access to lead_sources"
  ON public.lead_sources
  FOR ALL
  USING (true)
  WITH CHECK (true);
