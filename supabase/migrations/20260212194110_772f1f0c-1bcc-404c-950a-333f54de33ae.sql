
-- Drop restrictive policies that don't work with Clerk auth
DROP POLICY IF EXISTS "capi_event_def_select" ON capi_event_definitions;
DROP POLICY IF EXISTS "capi_event_def_insert" ON capi_event_definitions;
DROP POLICY IF EXISTS "capi_event_def_update" ON capi_event_definitions;
DROP POLICY IF EXISTS "capi_event_def_delete" ON capi_event_definitions;

-- Use permissive policies matching project pattern (Clerk handles auth, app layer handles org isolation)
CREATE POLICY "capi_event_def_select" ON capi_event_definitions FOR SELECT USING (true);
CREATE POLICY "capi_event_def_insert" ON capi_event_definitions FOR INSERT WITH CHECK (true);
CREATE POLICY "capi_event_def_update" ON capi_event_definitions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "capi_event_def_delete" ON capi_event_definitions FOR DELETE USING (true);
