-- Force-purge any remaining orgs in `organizations` table
DO $$
DECLARE
  o record;
  result jsonb;
BEGIN
  FOR o IN SELECT id, name FROM organizations LOOP
    SELECT public.purge_organization_cascade(o.id) INTO result;
    RAISE NOTICE 'Purged legacy org %: %', o.name, result;
  END LOOP;
END;
$$;