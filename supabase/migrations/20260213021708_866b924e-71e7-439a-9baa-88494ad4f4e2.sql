
-- ============================================================
-- FASE 4: RLS org-scoped + role-based (admin/seller)
-- ============================================================

-- 4.1: Create get_my_role() function
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.org_members
  WHERE clerk_user_id = (auth.jwt() ->> 'sub')
  LIMIT 1;
$$;

-- ============================================================
-- 4.2: Fix missing CRUD policies on tables that only have SELECT
-- ============================================================

-- automation_runs: sellers need UPDATE (move stages, etc.)
CREATE POLICY "Org members can insert automation_runs" ON public.automation_runs
  FOR INSERT TO authenticated WITH CHECK (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can update automation_runs" ON public.automation_runs
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_my_org_id())
  WITH CHECK (organization_id = public.get_my_org_id());

-- automation_jobs: only service_role writes (already has FOR ALL service_role)
-- automation_logs: only service_role writes (already has FOR ALL service_role)

-- whatsapp_routing_state: service_role manages, members only view (already correct)

-- ============================================================
-- 4.3: Fix opportunities — replace old subquery policies with get_my_org_id()
-- ============================================================
DROP POLICY IF EXISTS "Users can view opportunities in their org" ON public.opportunities;
DROP POLICY IF EXISTS "Users can insert opportunities in their org" ON public.opportunities;
DROP POLICY IF EXISTS "Users can update opportunities in their org" ON public.opportunities;
DROP POLICY IF EXISTS "Users can delete opportunities in their org" ON public.opportunities;
DROP POLICY IF EXISTS "Service role full access to opportunities" ON public.opportunities;

CREATE POLICY "Org members can select opportunities" ON public.opportunities
  FOR SELECT TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can insert opportunities" ON public.opportunities
  FOR INSERT TO authenticated WITH CHECK (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can update opportunities" ON public.opportunities
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_my_org_id())
  WITH CHECK (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can delete opportunities" ON public.opportunities
  FOR DELETE TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Service role full access opportunities" ON public.opportunities
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 4.4: Fix pipelines — replace old subquery policies
-- ============================================================
DROP POLICY IF EXISTS "Users can view pipelines in their org" ON public.pipelines;
DROP POLICY IF EXISTS "Admins can manage pipelines" ON public.pipelines;

CREATE POLICY "Org members can view pipelines" ON public.pipelines
  FOR SELECT TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Admins can manage pipelines" ON public.pipelines
  FOR ALL TO authenticated
  USING (organization_id = public.get_my_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_my_org_id() AND public.is_org_admin());
CREATE POLICY "Service role full access pipelines" ON public.pipelines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 4.5: Fix organizations — restrict to admin-only updates
-- ============================================================
DROP POLICY IF EXISTS "Allow public read on organizations" ON public.organizations;
DROP POLICY IF EXISTS "Allow public update on organizations" ON public.organizations;
DROP POLICY IF EXISTS "Allow public insert on organizations" ON public.organizations;

CREATE POLICY "Org members can view own org" ON public.organizations
  FOR SELECT TO authenticated USING (id = public.get_my_org_id());
CREATE POLICY "Admins can update own org" ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = public.get_my_org_id() AND public.is_org_admin())
  WITH CHECK (id = public.get_my_org_id() AND public.is_org_admin());
CREATE POLICY "Service role full access organizations" ON public.organizations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 4.6: Fix webhook_configurations — admin only
-- ============================================================
DROP POLICY IF EXISTS "Dev: acesso total webhook_configurations" ON public.webhook_configurations;

CREATE POLICY "Org members can view webhook_configurations" ON public.webhook_configurations
  FOR SELECT TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Admins can manage webhook_configurations" ON public.webhook_configurations
  FOR ALL TO authenticated
  USING (organization_id = public.get_my_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_my_org_id() AND public.is_org_admin());
CREATE POLICY "Service role full access webhook_configurations" ON public.webhook_configurations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 4.7: Fix lead_distribution_settings — admin only, use get_my_org_id
-- ============================================================
DROP POLICY IF EXISTS "Users can view distribution settings" ON public.lead_distribution_settings;
DROP POLICY IF EXISTS "Admins can manage distribution settings" ON public.lead_distribution_settings;

CREATE POLICY "Org members can view lead_distribution" ON public.lead_distribution_settings
  FOR SELECT TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Admins can manage lead_distribution" ON public.lead_distribution_settings
  FOR ALL TO authenticated
  USING (organization_id = public.get_my_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_my_org_id() AND public.is_org_admin());
CREATE POLICY "Service role full access lead_distribution" ON public.lead_distribution_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 4.8: Fix users_profile — only admin can update others, user can update self
-- ============================================================
DROP POLICY IF EXISTS "Users can view own profile and org members profiles" ON public.users_profile;

CREATE POLICY "Org members can view profiles in org" ON public.users_profile
  FOR SELECT TO authenticated
  USING (
    clerk_user_id = (auth.jwt() ->> 'sub')
    OR clerk_user_id IN (
      SELECT om2.clerk_user_id FROM org_members om2
      WHERE om2.clerk_org_id IN (
        SELECT om1.clerk_org_id FROM org_members om1
        WHERE om1.clerk_user_id = (auth.jwt() ->> 'sub')
      )
    )
  );

CREATE POLICY "Users can update own profile" ON public.users_profile
  FOR UPDATE TO authenticated
  USING (clerk_user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (clerk_user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Service role full access users_profile" ON public.users_profile
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 4.9: Automations — allow sellers to create own automations
-- ============================================================
-- Currently admins-only for ALL. Add INSERT for sellers:
CREATE POLICY "Sellers can create automations" ON public.automations
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_my_org_id());

-- ============================================================
-- VALIDATION: Check all target tables have RLS enabled
-- ============================================================
DO $$
DECLARE
  tbl text;
  rls_on boolean;
  tables_checked text[] := ARRAY[
    'automations','automation_flows','automation_jobs','automation_logs','automation_runs',
    'whatsapp_routing_bucket_settings','whatsapp_routing_settings','whatsapp_routing_state',
    'leads','conversations','messages','opportunities','pipelines',
    'organizations','users_profile','webhook_configurations','lead_distribution_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_checked LOOP
    SELECT relrowsecurity INTO rls_on FROM pg_class WHERE relname = tbl AND relnamespace = 'public'::regnamespace;
    IF rls_on IS NULL THEN
      RAISE NOTICE '⚠️ Table % not found', tbl;
    ELSIF NOT rls_on THEN
      RAISE WARNING '❌ RLS disabled on %', tbl;
    ELSE
      RAISE NOTICE '✅ RLS enabled on %', tbl;
    END IF;
  END LOOP;
END $$;
