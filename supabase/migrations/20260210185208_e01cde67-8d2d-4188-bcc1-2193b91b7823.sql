-- Drop existing restrictive policies that use auth.uid() (which is null with Clerk)
DROP POLICY IF EXISTS "Users can insert leads" ON public.leads;
DROP POLICY IF EXISTS "Users can view leads in their org" ON public.leads;
DROP POLICY IF EXISTS "Users can update their leads or admins all" ON public.leads;
DROP POLICY IF EXISTS "Admins can delete leads" ON public.leads;

-- Create permissive policies for Clerk-based auth (app-level security via organization_id filtering)
CREATE POLICY "Allow insert leads"
  ON public.leads FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow select leads"
  ON public.leads FOR SELECT
  USING (true);

CREATE POLICY "Allow update leads"
  ON public.leads FOR UPDATE
  USING (true);

CREATE POLICY "Allow delete leads"
  ON public.leads FOR DELETE
  USING (true);