
-- 0. Remover triggers antigas que referenciam campo inexistente
DROP TRIGGER IF EXISTS trg_seed_pipeline_on_organizations ON public.organizations;
DROP TRIGGER IF EXISTS trg_seed_pipeline_on_clerk_organizations ON public.clerk_organizations;
DROP FUNCTION IF EXISTS public.trg_seed_pipeline_on_new_org();

-- 1. Trigger em clerk_organizations: espelhar para organizations
CREATE OR REPLACE FUNCTION public.trg_mirror_clerk_org_to_organizations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organizations (id, name, is_active)
  VALUES (NEW.id, NEW.name, true)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_clerk_org ON public.clerk_organizations;
CREATE TRIGGER trg_mirror_clerk_org
AFTER INSERT ON public.clerk_organizations
FOR EACH ROW
EXECUTE FUNCTION public.trg_mirror_clerk_org_to_organizations();

-- 2. Trigger em org_members: seed pipeline quando o primeiro membro entra
CREATE OR REPLACE FUNCTION public.trg_seed_pipeline_on_first_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_pipeline_id uuid;
BEGIN
  SELECT id INTO v_existing_pipeline_id
  FROM public.pipelines
  WHERE organization_id = NEW.organization_id
  LIMIT 1;

  IF v_existing_pipeline_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.seed_default_pipeline(NEW.organization_id, NEW.clerk_user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'seed_default_pipeline (on first member) falhou para org %: %', NEW.organization_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_pipeline_on_first_member ON public.org_members;
CREATE TRIGGER trg_seed_pipeline_on_first_member
AFTER INSERT ON public.org_members
FOR EACH ROW
EXECUTE FUNCTION public.trg_seed_pipeline_on_first_member();

-- 3. Backfill
DO $$
DECLARE
  v_org RECORD;
BEGIN
  FOR v_org IN
    SELECT co.id, co.name, co.created_by_clerk_user_id
    FROM public.clerk_organizations co
    WHERE co.deleted_at IS NULL
  LOOP
    INSERT INTO public.organizations (id, name, is_active)
    VALUES (v_org.id, v_org.name, true)
    ON CONFLICT (id) DO NOTHING;

    IF NOT EXISTS (SELECT 1 FROM public.pipelines WHERE organization_id = v_org.id) THEN
      BEGIN
        PERFORM public.seed_default_pipeline(
          v_org.id,
          COALESCE(v_org.created_by_clerk_user_id, 'system')
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Backfill seed falhou para org % (%): %', v_org.id, v_org.name, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;
