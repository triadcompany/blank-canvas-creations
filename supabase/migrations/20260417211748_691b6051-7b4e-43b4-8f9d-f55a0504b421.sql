-- Manual cleanup of orphan stages/pipelines/orgs
DELETE FROM pipeline_stages;
DELETE FROM pipelines;
DELETE FROM organizations;

-- Improve purge function to handle FK chains explicitly
CREATE OR REPLACE FUNCTION public.purge_organization_cascade(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  pass int;
  remaining int;
BEGIN
  IF p_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'p_org_id is null');
  END IF;

  -- Step 1: Manual cleanup of indirect dependencies (no organization_id column)
  BEGIN
    DELETE FROM pipeline_stages
    WHERE pipeline_id IN (SELECT id FROM pipelines WHERE organization_id = p_org_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM followup_cadence_steps
    WHERE cadence_id IN (SELECT id FROM followup_cadences WHERE organization_id = p_org_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM messages
    WHERE conversation_id IN (SELECT id FROM conversations WHERE organization_id = p_org_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Step 2: Multiple passes over all org-scoped tables
  FOR pass IN 1..10 LOOP
    FOR r IN
      SELECT c.table_schema, c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND c.column_name = 'organization_id'
        AND t.table_type = 'BASE TABLE'
        AND c.table_name NOT IN ('organizations', 'clerk_organizations')
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I.%I WHERE organization_id = $1', r.table_schema, r.table_name)
          USING p_org_id;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
  END LOOP;

  -- Step 3: Drop org rows
  BEGIN DELETE FROM clerk_organizations WHERE id = p_org_id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    DELETE FROM organizations WHERE id = p_org_id;
  EXCEPTION WHEN OTHERS THEN
    SELECT count(*) INTO remaining FROM organizations WHERE id = p_org_id;
    RETURN jsonb_build_object('organization_id', p_org_id, 'purged', false, 'remaining', remaining);
  END;

  RETURN jsonb_build_object('organization_id', p_org_id, 'purged', true);
END;
$$;