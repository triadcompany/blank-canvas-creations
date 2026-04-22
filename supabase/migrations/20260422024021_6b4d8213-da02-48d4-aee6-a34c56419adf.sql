
-- Trigger em profiles: tentar seed de pipeline para todas as orgs do usuário sem pipeline
CREATE OR REPLACE FUNCTION public.trg_seed_pipeline_on_profile_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF NEW.clerk_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_org_id IN
    SELECT om.organization_id
    FROM org_members om
    WHERE om.clerk_user_id = NEW.clerk_user_id
      AND om.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.organization_id = om.organization_id)
  LOOP
    BEGIN
      PERFORM public.seed_default_pipeline(v_org_id, NEW.clerk_user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'seed_default_pipeline (on profile insert) falhou para org %: %', v_org_id, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_pipeline_on_profile_insert ON public.profiles;
CREATE TRIGGER trg_seed_pipeline_on_profile_insert
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.trg_seed_pipeline_on_profile_insert();

-- Backfill: criar profiles mínimos para usuários admin sem profile e seedar pipeline
DO $$
DECLARE
  v_member RECORD;
  v_profile_id uuid;
BEGIN
  FOR v_member IN
    SELECT DISTINCT om.clerk_user_id, om.organization_id
    FROM org_members om
    WHERE om.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.clerk_user_id = om.clerk_user_id)
      AND NOT EXISTS (SELECT 1 FROM pipelines pp WHERE pp.organization_id = om.organization_id)
  LOOP
    -- cria profile mínimo
    INSERT INTO profiles (clerk_user_id, email, name, organization_id, onboarding_completed)
    VALUES (v_member.clerk_user_id, '', 'User', v_member.organization_id, true)
    ON CONFLICT (clerk_user_id) DO NOTHING
    RETURNING id INTO v_profile_id;

    -- tenta seed
    BEGIN
      PERFORM public.seed_default_pipeline(v_member.organization_id, v_member.clerk_user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Backfill profile-then-seed falhou para org %: %', v_member.organization_id, SQLERRM;
    END;
  END LOOP;
END $$;
