
-- ===========================================================
-- Fix 1: profiles SELECT/UPDATE policies (privilege escalation + public PII)
-- ===========================================================

DROP POLICY IF EXISTS "Users can view profiles by clerk_user_id" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

-- Authenticated users can view profiles only within their own organization
CREATE POLICY "Users can view profiles in their org"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  clerk_user_id = public.get_clerk_user_id()
  OR organization_id = public.get_my_org_id()
);

-- Users can update only their own profile row
CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (clerk_user_id = public.get_clerk_user_id())
WITH CHECK (clerk_user_id = public.get_clerk_user_id());

-- ===========================================================
-- Fix 2: conversation_events fully public CRUD
-- ===========================================================

DROP POLICY IF EXISTS "conversation_events_select" ON public.conversation_events;
DROP POLICY IF EXISTS "conversation_events_insert" ON public.conversation_events;
DROP POLICY IF EXISTS "conversation_events_update" ON public.conversation_events;
DROP POLICY IF EXISTS "conversation_events_delete" ON public.conversation_events;

CREATE POLICY "conversation_events_select"
ON public.conversation_events
FOR SELECT
TO authenticated
USING (organization_id = public.get_my_org_id());

CREATE POLICY "conversation_events_insert"
ON public.conversation_events
FOR INSERT
TO authenticated
WITH CHECK (organization_id = public.get_my_org_id());

CREATE POLICY "conversation_events_update"
ON public.conversation_events
FOR UPDATE
TO authenticated
USING (organization_id = public.get_my_org_id())
WITH CHECK (organization_id = public.get_my_org_id());

CREATE POLICY "conversation_events_delete"
ON public.conversation_events
FOR DELETE
TO authenticated
USING (organization_id = public.get_my_org_id() AND public.is_org_admin());

-- ===========================================================
-- Fix 3: evolution_webhook_logs - service-role-only + admin org-scoped read
-- ===========================================================

DROP POLICY IF EXISTS "Service role full access" ON public.evolution_webhook_logs;

CREATE POLICY "Service role full access"
ON public.evolution_webhook_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Admins can view their org webhook logs"
ON public.evolution_webhook_logs
FOR SELECT
TO authenticated
USING (
  detected_organization_id = public.get_my_org_id()
  AND public.is_org_admin()
);
