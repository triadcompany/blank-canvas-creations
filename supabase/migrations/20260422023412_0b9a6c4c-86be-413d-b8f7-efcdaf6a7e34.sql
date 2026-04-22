-- Trigger function: chama seed_default_pipeline ao criar organization
CREATE OR REPLACE FUNCTION public.trg_seed_pipeline_on_new_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator text;
BEGIN
  -- Identifica criador (varia conforme tabela)
  v_creator := COALESCE(
    NEW.created_by_clerk_user_id,
    'system'
  );

  BEGIN
    PERFORM public.seed_default_pipeline(NEW.id, v_creator);
  EXCEPTION WHEN OTHERS THEN
    -- Não bloquear criação da org se o seed falhar; log via raise notice
    RAISE NOTICE 'seed_default_pipeline falhou para org %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Trigger em organizations
DROP TRIGGER IF EXISTS trg_seed_pipeline_on_organizations ON public.organizations;
CREATE TRIGGER trg_seed_pipeline_on_organizations
AFTER INSERT ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.trg_seed_pipeline_on_new_org();

-- Trigger em clerk_organizations (caminho usado pelo bootstrap-org)
DROP TRIGGER IF EXISTS trg_seed_pipeline_on_clerk_organizations ON public.clerk_organizations;
CREATE TRIGGER trg_seed_pipeline_on_clerk_organizations
AFTER INSERT ON public.clerk_organizations
FOR EACH ROW
EXECUTE FUNCTION public.trg_seed_pipeline_on_new_org();

-- Backfill: cria pipeline padrão para orgs existentes que não têm nenhum pipeline
DO $$
DECLARE
  v_org RECORD;
BEGIN
  FOR v_org IN
    SELECT co.id, co.created_by_clerk_user_id
    FROM public.clerk_organizations co
    WHERE NOT EXISTS (
      SELECT 1 FROM public.pipelines p WHERE p.organization_id = co.id
    )
    AND co.deleted_at IS NULL
  LOOP
    BEGIN
      PERFORM public.seed_default_pipeline(
        v_org.id,
        COALESCE(v_org.created_by_clerk_user_id, 'system')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Backfill falhou para org %: %', v_org.id, SQLERRM;
    END;
  END LOOP;
END $$;