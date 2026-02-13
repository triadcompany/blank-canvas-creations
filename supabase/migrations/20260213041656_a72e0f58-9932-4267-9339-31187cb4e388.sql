-- Allow inserting into clerk_organizations during sync (Clerk auth uses anon role)
CREATE POLICY "Allow clerk_organizations insert during sync"
ON public.clerk_organizations
FOR INSERT
WITH CHECK (true);

-- Also allow update for upsert to work
CREATE POLICY "Allow clerk_organizations update during sync"
ON public.clerk_organizations
FOR UPDATE
USING (true)
WITH CHECK (true);