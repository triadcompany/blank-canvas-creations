
-- ============================================================
-- PASSO 3A: Hardening RLS — CRM Core Tables
-- Padrão: SELECT/UPDATE/DELETE -> organization_id = get_my_org_id()
--         INSERT -> WITH CHECK organization_id = get_my_org_id()
--         service_role mantém acesso total
-- ============================================================

-- ==================== crm_leads ====================
DROP POLICY IF EXISTS "Dev: acesso total leads" ON public.crm_leads;
CREATE POLICY "Org members can select crm_leads" ON public.crm_leads FOR SELECT TO authenticated
  USING (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can insert crm_leads" ON public.crm_leads FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can update crm_leads" ON public.crm_leads FOR UPDATE TO authenticated
  USING (organization_id = public.get_my_org_id()) WITH CHECK (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can delete crm_leads" ON public.crm_leads FOR DELETE TO authenticated
  USING (organization_id = public.get_my_org_id());
CREATE POLICY "Service role full access crm_leads" ON public.crm_leads FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ==================== crm_lead_activities ====================
DROP POLICY IF EXISTS "Dev: acesso total activities" ON public.crm_lead_activities;
CREATE POLICY "Org members can manage activities" ON public.crm_lead_activities FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_activities.lead_id AND l.organization_id = public.get_my_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_activities.lead_id AND l.organization_id = public.get_my_org_id()));
CREATE POLICY "Service role full access activities" ON public.crm_lead_activities FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ==================== crm_lead_notes ====================
DROP POLICY IF EXISTS "Dev: acesso total notes" ON public.crm_lead_notes;
CREATE POLICY "Org members can manage notes" ON public.crm_lead_notes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_notes.lead_id AND l.organization_id = public.get_my_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_notes.lead_id AND l.organization_id = public.get_my_org_id()));
CREATE POLICY "Service role full access notes" ON public.crm_lead_notes FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ==================== crm_stages ====================
DROP POLICY IF EXISTS "Dev: acesso total stages" ON public.crm_stages;
CREATE POLICY "Org members can select stages" ON public.crm_stages FOR SELECT TO authenticated
  USING (organization_id = public.get_my_org_id());
CREATE POLICY "Admins can manage stages" ON public.crm_stages FOR ALL TO authenticated
  USING (organization_id = public.get_my_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_my_org_id() AND public.is_org_admin());
CREATE POLICY "Service role full access stages" ON public.crm_stages FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ==================== leads ====================
DROP POLICY IF EXISTS "Allow delete leads" ON public.leads;
DROP POLICY IF EXISTS "Allow insert leads" ON public.leads;
DROP POLICY IF EXISTS "Allow select leads" ON public.leads;
DROP POLICY IF EXISTS "Allow update leads" ON public.leads;
CREATE POLICY "Org members can select leads" ON public.leads FOR SELECT TO authenticated
  USING (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can insert leads" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can update leads" ON public.leads FOR UPDATE TO authenticated
  USING (organization_id = public.get_my_org_id()) WITH CHECK (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can delete leads" ON public.leads FOR DELETE TO authenticated
  USING (organization_id = public.get_my_org_id());
CREATE POLICY "Service role full access leads" ON public.leads FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ==================== conversations ====================
DROP POLICY IF EXISTS "Allow delete conversations" ON public.conversations;
DROP POLICY IF EXISTS "Allow insert conversations" ON public.conversations;
DROP POLICY IF EXISTS "Allow select conversations" ON public.conversations;
DROP POLICY IF EXISTS "Allow update conversations" ON public.conversations;
-- Keep service_role policy
CREATE POLICY "Org members can select conversations" ON public.conversations FOR SELECT TO authenticated
  USING (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can insert conversations" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can update conversations" ON public.conversations FOR UPDATE TO authenticated
  USING (organization_id = public.get_my_org_id()) WITH CHECK (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can delete conversations" ON public.conversations FOR DELETE TO authenticated
  USING (organization_id = public.get_my_org_id());

-- ==================== messages ====================
DROP POLICY IF EXISTS "Allow delete messages" ON public.messages;
DROP POLICY IF EXISTS "Allow insert messages" ON public.messages;
DROP POLICY IF EXISTS "Allow select messages" ON public.messages;
DROP POLICY IF EXISTS "Allow update messages" ON public.messages;
-- Keep service_role policy
CREATE POLICY "Org members can select messages" ON public.messages FOR SELECT TO authenticated
  USING (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can insert messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can update messages" ON public.messages FOR UPDATE TO authenticated
  USING (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can delete messages" ON public.messages FOR DELETE TO authenticated
  USING (organization_id = public.get_my_org_id());

-- ==================== lead_sources ====================
DROP POLICY IF EXISTS "Allow all access to lead_sources" ON public.lead_sources;
CREATE POLICY "Org members can select lead_sources" ON public.lead_sources FOR SELECT TO authenticated
  USING (organization_id = public.get_my_org_id());
CREATE POLICY "Admins can manage lead_sources" ON public.lead_sources FOR ALL TO authenticated
  USING (organization_id = public.get_my_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_my_org_id() AND public.is_org_admin());
CREATE POLICY "Service role full access lead_sources" ON public.lead_sources FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ==================== notifications ====================
DROP POLICY IF EXISTS "Dev: full access notifications" ON public.notifications;
CREATE POLICY "Org members can select notifications" ON public.notifications FOR SELECT TO authenticated
  USING (organization_id = public.get_my_org_id());
CREATE POLICY "Org members can update notifications" ON public.notifications FOR UPDATE TO authenticated
  USING (organization_id = public.get_my_org_id());
CREATE POLICY "Service role full access notifications" ON public.notifications FOR ALL TO service_role USING (true) WITH CHECK (true);
