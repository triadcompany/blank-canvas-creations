-- 1. Insert missing organization
INSERT INTO public.organizations (id, name, is_active)
VALUES ('24788a87-6421-4e4e-953a-73970dca2281', 'Garage Motors Brand', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Create profile
INSERT INTO public.profiles (clerk_user_id, name, email, organization_id, onboarding_completed)
VALUES ('user_39lI8KI0f9SyZPUq9uwDkr3alNj', 'Cristian GMB', '', '24788a87-6421-4e4e-953a-73970dca2281', true)
ON CONFLICT (clerk_user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id;

-- 3. Seed pipeline, stages, and lead sources
DO $$
DECLARE
  v_profile_id UUID;
  v_pipeline_id UUID;
  v_org_id UUID := '24788a87-6421-4e4e-953a-73970dca2281';
BEGIN
  SELECT id INTO v_profile_id FROM public.profiles WHERE clerk_user_id = 'user_39lI8KI0f9SyZPUq9uwDkr3alNj';

  -- Pipeline
  INSERT INTO public.pipelines (organization_id, name, is_default, created_by)
  VALUES (v_org_id, 'Pipeline Principal', true, v_profile_id)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_pipeline_id FROM public.pipelines
  WHERE organization_id = v_org_id AND is_default = true LIMIT 1;

  IF v_pipeline_id IS NOT NULL THEN
    INSERT INTO public.pipeline_stages (pipeline_id, name, position, color, created_by)
    VALUES
      (v_pipeline_id, 'Novo Lead', 0, '#3B82F6', v_profile_id),
      (v_pipeline_id, 'Andamento', 1, '#F59E0B', v_profile_id),
      (v_pipeline_id, 'Qualificado', 2, '#10B981', v_profile_id),
      (v_pipeline_id, 'Agendado', 3, '#8B5CF6', v_profile_id),
      (v_pipeline_id, 'Visita Realizada', 4, '#6366F1', v_profile_id),
      (v_pipeline_id, 'Negociando Proposta', 5, '#EC4899', v_profile_id),
      (v_pipeline_id, 'Venda', 6, '#22C55E', v_profile_id),
      (v_pipeline_id, 'Follow Up', 7, '#F97316', v_profile_id),
      (v_pipeline_id, 'Perdido', 8, '#EF4444', v_profile_id)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

-- 4. Lead sources
INSERT INTO public.lead_sources (organization_id, name, is_active, sort_order)
VALUES
  ('24788a87-6421-4e4e-953a-73970dca2281', 'Meta Ads', true, 0),
  ('24788a87-6421-4e4e-953a-73970dca2281', 'Indicação', true, 1),
  ('24788a87-6421-4e4e-953a-73970dca2281', 'Instagram Orgânico', true, 2),
  ('24788a87-6421-4e4e-953a-73970dca2281', 'WhatsApp', true, 3),
  ('24788a87-6421-4e4e-953a-73970dca2281', 'Marketplace', true, 4)
ON CONFLICT DO NOTHING;