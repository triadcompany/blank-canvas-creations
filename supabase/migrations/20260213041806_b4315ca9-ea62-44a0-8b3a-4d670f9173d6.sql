-- Allow org_members insert during Clerk sync (anon role)
CREATE POLICY "Allow org_members insert during sync"
ON public.org_members
FOR INSERT
WITH CHECK (true);

-- Allow org_members update during Clerk sync (anon role)
CREATE POLICY "Allow org_members update during sync"
ON public.org_members
FOR UPDATE
USING (true)
WITH CHECK (true);