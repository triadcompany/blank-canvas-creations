
-- ============================================================
-- FASE 3: Padronizar organization_id de TEXT para UUID
-- Tabelas afetadas: automations, automation_flows, automation_jobs,
--   automation_logs, automation_runs, whatsapp_routing_bucket_settings,
--   whatsapp_routing_settings, whatsapp_routing_state
-- Todas com 0 valores inválidos (verificado previamente).
-- ============================================================

-- Helper: safe cast function (for safety, even though no invalids found)
CREATE OR REPLACE FUNCTION pg_temp.safe_text_to_uuid(val text)
RETURNS uuid AS $$
BEGIN
  IF val IS NULL OR val = '' THEN RETURN NULL; END IF;
  IF val ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN val::uuid;
  END IF;
  RAISE WARNING 'Invalid UUID skipped: %', val;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────
-- 1. automations
-- ────────────────────────────────────────────────────
-- Drop existing policies that reference organization_id
DO $$ BEGIN
  EXECUTE (
    SELECT string_agg('DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON public.automations;', E'\n')
    FROM pg_policies WHERE schemaname='public' AND tablename='automations'
  );
END $$;

ALTER TABLE public.automations
  ADD COLUMN organization_id_new uuid;
UPDATE public.automations SET organization_id_new = pg_temp.safe_text_to_uuid(organization_id);
ALTER TABLE public.automations DROP COLUMN organization_id;
ALTER TABLE public.automations RENAME COLUMN organization_id_new TO organization_id;
ALTER TABLE public.automations ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX idx_automations_org ON public.automations(organization_id);

-- ────────────────────────────────────────────────────
-- 2. automation_flows
-- ────────────────────────────────────────────────────
DO $$ BEGIN
  EXECUTE (
    SELECT coalesce(string_agg('DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON public.automation_flows;', E'\n'), 'SELECT 1')
    FROM pg_policies WHERE schemaname='public' AND tablename='automation_flows'
  );
END $$;

ALTER TABLE public.automation_flows
  ADD COLUMN organization_id_new uuid;
UPDATE public.automation_flows SET organization_id_new = pg_temp.safe_text_to_uuid(organization_id);
ALTER TABLE public.automation_flows DROP COLUMN organization_id;
ALTER TABLE public.automation_flows RENAME COLUMN organization_id_new TO organization_id;
ALTER TABLE public.automation_flows ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX idx_automation_flows_org ON public.automation_flows(organization_id);

-- ────────────────────────────────────────────────────
-- 3. automation_jobs
-- ────────────────────────────────────────────────────
DO $$ BEGIN
  EXECUTE (
    SELECT coalesce(string_agg('DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON public.automation_jobs;', E'\n'), 'SELECT 1')
    FROM pg_policies WHERE schemaname='public' AND tablename='automation_jobs'
  );
END $$;

ALTER TABLE public.automation_jobs
  ADD COLUMN organization_id_new uuid;
UPDATE public.automation_jobs SET organization_id_new = pg_temp.safe_text_to_uuid(organization_id);
ALTER TABLE public.automation_jobs DROP COLUMN organization_id;
ALTER TABLE public.automation_jobs RENAME COLUMN organization_id_new TO organization_id;
ALTER TABLE public.automation_jobs ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX idx_automation_jobs_org ON public.automation_jobs(organization_id);

-- ────────────────────────────────────────────────────
-- 4. automation_logs
-- ────────────────────────────────────────────────────
DO $$ BEGIN
  EXECUTE (
    SELECT coalesce(string_agg('DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON public.automation_logs;', E'\n'), 'SELECT 1')
    FROM pg_policies WHERE schemaname='public' AND tablename='automation_logs'
  );
END $$;

ALTER TABLE public.automation_logs
  ADD COLUMN organization_id_new uuid;
UPDATE public.automation_logs SET organization_id_new = pg_temp.safe_text_to_uuid(organization_id);
ALTER TABLE public.automation_logs DROP COLUMN organization_id;
ALTER TABLE public.automation_logs RENAME COLUMN organization_id_new TO organization_id;
ALTER TABLE public.automation_logs ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX idx_automation_logs_org ON public.automation_logs(organization_id);

-- ────────────────────────────────────────────────────
-- 5. automation_runs
-- ────────────────────────────────────────────────────
DO $$ BEGIN
  EXECUTE (
    SELECT coalesce(string_agg('DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON public.automation_runs;', E'\n'), 'SELECT 1')
    FROM pg_policies WHERE schemaname='public' AND tablename='automation_runs'
  );
END $$;

ALTER TABLE public.automation_runs
  ADD COLUMN organization_id_new uuid;
UPDATE public.automation_runs SET organization_id_new = pg_temp.safe_text_to_uuid(organization_id);
ALTER TABLE public.automation_runs DROP COLUMN organization_id;
ALTER TABLE public.automation_runs RENAME COLUMN organization_id_new TO organization_id;
ALTER TABLE public.automation_runs ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX idx_automation_runs_org ON public.automation_runs(organization_id);

-- ────────────────────────────────────────────────────
-- 6. whatsapp_routing_bucket_settings
-- ────────────────────────────────────────────────────
DO $$ BEGIN
  EXECUTE (
    SELECT coalesce(string_agg('DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON public.whatsapp_routing_bucket_settings;', E'\n'), 'SELECT 1')
    FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_routing_bucket_settings'
  );
END $$;

ALTER TABLE public.whatsapp_routing_bucket_settings
  ADD COLUMN organization_id_new uuid;
UPDATE public.whatsapp_routing_bucket_settings SET organization_id_new = pg_temp.safe_text_to_uuid(organization_id);
ALTER TABLE public.whatsapp_routing_bucket_settings DROP COLUMN organization_id;
ALTER TABLE public.whatsapp_routing_bucket_settings RENAME COLUMN organization_id_new TO organization_id;
ALTER TABLE public.whatsapp_routing_bucket_settings ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX idx_wa_routing_bucket_org ON public.whatsapp_routing_bucket_settings(organization_id);

-- ────────────────────────────────────────────────────
-- 7. whatsapp_routing_settings
-- ────────────────────────────────────────────────────
DO $$ BEGIN
  EXECUTE (
    SELECT coalesce(string_agg('DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON public.whatsapp_routing_settings;', E'\n'), 'SELECT 1')
    FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_routing_settings'
  );
END $$;

ALTER TABLE public.whatsapp_routing_settings
  ADD COLUMN organization_id_new uuid;
UPDATE public.whatsapp_routing_settings SET organization_id_new = pg_temp.safe_text_to_uuid(organization_id);
ALTER TABLE public.whatsapp_routing_settings DROP COLUMN organization_id;
ALTER TABLE public.whatsapp_routing_settings RENAME COLUMN organization_id_new TO organization_id;
ALTER TABLE public.whatsapp_routing_settings ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX idx_wa_routing_settings_org ON public.whatsapp_routing_settings(organization_id);

-- ────────────────────────────────────────────────────
-- 8. whatsapp_routing_state
-- ────────────────────────────────────────────────────
DO $$ BEGIN
  EXECUTE (
    SELECT coalesce(string_agg('DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON public.whatsapp_routing_state;', E'\n'), 'SELECT 1')
    FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_routing_state'
  );
END $$;

ALTER TABLE public.whatsapp_routing_state
  ADD COLUMN organization_id_new uuid;
UPDATE public.whatsapp_routing_state SET organization_id_new = pg_temp.safe_text_to_uuid(organization_id);
ALTER TABLE public.whatsapp_routing_state DROP COLUMN organization_id;
ALTER TABLE public.whatsapp_routing_state RENAME COLUMN organization_id_new TO organization_id;
ALTER TABLE public.whatsapp_routing_state ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX idx_wa_routing_state_org ON public.whatsapp_routing_state(organization_id);

-- ============================================================
-- Agora recriar RLS policies para todas as 8 tabelas
-- ============================================================

-- automations (admin-only management)
CREATE POLICY "Org members can view automations" ON public.automations
  FOR SELECT TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Admins can manage automations" ON public.automations
  FOR ALL TO authenticated
  USING (organization_id = public.get_my_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_my_org_id() AND public.is_org_admin());
CREATE POLICY "Service role full access automations" ON public.automations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- automation_flows
CREATE POLICY "Org members can view automation_flows" ON public.automation_flows
  FOR SELECT TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Admins can manage automation_flows" ON public.automation_flows
  FOR ALL TO authenticated
  USING (organization_id = public.get_my_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_my_org_id() AND public.is_org_admin());
CREATE POLICY "Service role full access automation_flows" ON public.automation_flows
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- automation_jobs
CREATE POLICY "Org members can view automation_jobs" ON public.automation_jobs
  FOR SELECT TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Service role full access automation_jobs" ON public.automation_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- automation_logs
CREATE POLICY "Org members can view automation_logs" ON public.automation_logs
  FOR SELECT TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Service role full access automation_logs" ON public.automation_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- automation_runs
CREATE POLICY "Org members can view automation_runs" ON public.automation_runs
  FOR SELECT TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Service role full access automation_runs" ON public.automation_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- whatsapp_routing_bucket_settings
CREATE POLICY "Org members can view wa_routing_bucket" ON public.whatsapp_routing_bucket_settings
  FOR SELECT TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Admins can manage wa_routing_bucket" ON public.whatsapp_routing_bucket_settings
  FOR ALL TO authenticated
  USING (organization_id = public.get_my_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_my_org_id() AND public.is_org_admin());
CREATE POLICY "Service role full access wa_routing_bucket" ON public.whatsapp_routing_bucket_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- whatsapp_routing_settings
CREATE POLICY "Org members can view wa_routing_settings" ON public.whatsapp_routing_settings
  FOR SELECT TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Admins can manage wa_routing_settings" ON public.whatsapp_routing_settings
  FOR ALL TO authenticated
  USING (organization_id = public.get_my_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_my_org_id() AND public.is_org_admin());
CREATE POLICY "Service role full access wa_routing_settings" ON public.whatsapp_routing_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- whatsapp_routing_state
CREATE POLICY "Org members can view wa_routing_state" ON public.whatsapp_routing_state
  FOR SELECT TO authenticated USING (organization_id = public.get_my_org_id());
CREATE POLICY "Service role full access wa_routing_state" ON public.whatsapp_routing_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Verificação final: confirmar que não sobrou nenhuma tabela com organization_id text
-- ============================================================
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining
  FROM information_schema.columns
  WHERE table_schema='public' AND column_name='organization_id' AND data_type <> 'uuid';
  
  IF remaining > 0 THEN
    RAISE WARNING '⚠️ Still % tables with non-uuid organization_id', remaining;
  ELSE
    RAISE NOTICE '✅ All organization_id columns are now UUID';
  END IF;
END $$;
