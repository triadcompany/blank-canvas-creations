
-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow select for org members" ON capi_event_definitions;
DROP POLICY IF EXISTS "Allow insert for org members" ON capi_event_definitions;
DROP POLICY IF EXISTS "Allow update for org members" ON capi_event_definitions;
DROP POLICY IF EXISTS "Allow delete for org members" ON capi_event_definitions;
DROP POLICY IF EXISTS "capi_event_definitions_select" ON capi_event_definitions;
DROP POLICY IF EXISTS "capi_event_definitions_insert" ON capi_event_definitions;
DROP POLICY IF EXISTS "capi_event_definitions_update" ON capi_event_definitions;
DROP POLICY IF EXISTS "capi_event_definitions_delete" ON capi_event_definitions;

-- Ensure RLS is enabled
ALTER TABLE capi_event_definitions ENABLE ROW LEVEL SECURITY;

-- SELECT: users can see events from their org
CREATE POLICY "capi_event_def_select"
ON capi_event_definitions FOR SELECT TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE clerk_user_id = auth.jwt()->>'sub'
  )
);

-- INSERT: users can create events in their org
CREATE POLICY "capi_event_def_insert"
ON capi_event_definitions FOR INSERT TO authenticated
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE clerk_user_id = auth.jwt()->>'sub'
  )
);

-- UPDATE: users can update events in their org
CREATE POLICY "capi_event_def_update"
ON capi_event_definitions FOR UPDATE TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE clerk_user_id = auth.jwt()->>'sub'
  )
);

-- DELETE: users can delete events in their org
CREATE POLICY "capi_event_def_delete"
ON capi_event_definitions FOR DELETE TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE clerk_user_id = auth.jwt()->>'sub'
  )
);
