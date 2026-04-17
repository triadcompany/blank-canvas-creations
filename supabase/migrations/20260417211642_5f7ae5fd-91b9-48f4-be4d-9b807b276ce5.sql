DROP FUNCTION IF EXISTS public.purge_organization_cascade(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.purge_organization_by_clerk_id(text) CASCADE;
DROP FUNCTION IF EXISTS public.purge_user_cascade(text) CASCADE;
DROP FUNCTION IF EXISTS public.purge_org_membership(text, text) CASCADE;

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

  -- Iterate up to 10 passes; each pass deletes whatever it can.
  -- Tables that fail this pass (due to FKs) will succeed once their dependents are gone.
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
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END LOOP;
  END LOOP;

  -- Drop org rows; if still blocked, raise the actual error
  BEGIN
    DELETE FROM clerk_organizations WHERE id = p_org_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  
  BEGIN
    DELETE FROM organizations WHERE id = p_org_id;
  EXCEPTION WHEN OTHERS THEN
    -- Final attempt failed; return diagnostic
    SELECT count(*) INTO remaining FROM organizations WHERE id = p_org_id;
    RETURN jsonb_build_object('organization_id', p_org_id, 'purged', false, 'remaining', remaining);
  END;

  RETURN jsonb_build_object('organization_id', p_org_id, 'purged', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_organization_by_clerk_id(p_clerk_org_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT id INTO v_org_id FROM clerk_organizations WHERE clerk_org_id = p_clerk_org_id;
  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'clerk_org_id', p_clerk_org_id);
  END IF;
  RETURN public.purge_organization_cascade(v_org_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_user_cascade(p_clerk_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_profile_ids uuid[];
BEGIN
  IF p_clerk_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'p_clerk_user_id is null');
  END IF;

  SELECT array_agg(id) INTO v_profile_ids FROM profiles WHERE clerk_user_id = p_clerk_user_id;

  IF v_profile_ids IS NOT NULL THEN
    FOR r IN
      SELECT c.table_schema, c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND c.column_name IN ('assigned_to', 'created_by', 'updated_by', 'invited_by', 'applied_by', 'criado_por')
        AND c.is_nullable = 'YES'
        AND c.table_name NOT IN ('profiles', 'users_profile')
    LOOP
      BEGIN
        EXECUTE format('UPDATE %I.%I SET %I = NULL WHERE %I = ANY($1)',
          r.table_schema, r.table_name, r.column_name, r.column_name)
          USING v_profile_ids;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
  END IF;

  DELETE FROM user_roles WHERE clerk_user_id = p_clerk_user_id;
  DELETE FROM org_members WHERE clerk_user_id = p_clerk_user_id;
  DELETE FROM profiles WHERE clerk_user_id = p_clerk_user_id;
  BEGIN DELETE FROM users_profile WHERE clerk_user_id = p_clerk_user_id; EXCEPTION WHEN undefined_table THEN NULL; END;

  RETURN jsonb_build_object('clerk_user_id', p_clerk_user_id, 'purged', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_org_membership(p_clerk_org_id text, p_clerk_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT id INTO v_org_id FROM clerk_organizations WHERE clerk_org_id = p_clerk_org_id;
  DELETE FROM org_members WHERE clerk_org_id = p_clerk_org_id AND clerk_user_id = p_clerk_user_id;
  IF v_org_id IS NOT NULL THEN
    DELETE FROM user_roles WHERE clerk_user_id = p_clerk_user_id AND organization_id = v_org_id;
    UPDATE profiles SET organization_id = NULL
      WHERE clerk_user_id = p_clerk_user_id AND organization_id = v_org_id;
  END IF;
  RETURN jsonb_build_object('removed', true);
END;
$$;

-- =====================================================
-- IMMEDIATE CLEANUP
-- =====================================================
DO $$
DECLARE
  o record;
  result jsonb;
BEGIN
  FOR o IN SELECT id, name FROM clerk_organizations LOOP
    SELECT public.purge_organization_cascade(o.id) INTO result;
    RAISE NOTICE 'Purged org %: %', o.name, result;
  END LOOP;
  FOR o IN SELECT id, name FROM organizations LOOP
    SELECT public.purge_organization_cascade(o.id) INTO result;
    RAISE NOTICE 'Purged legacy org %: %', o.name, result;
  END LOOP;
  -- Final cleanup of any remaining identity rows
  DELETE FROM org_members;
  DELETE FROM user_roles;
  DELETE FROM profiles;
  BEGIN DELETE FROM users_profile; EXCEPTION WHEN undefined_table THEN NULL; END;
END;
$$;