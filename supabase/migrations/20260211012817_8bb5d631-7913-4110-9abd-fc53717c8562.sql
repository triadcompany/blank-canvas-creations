
-- Table already created from previous attempt, just add missing policies and index
-- The table was created but policies failed, so we need to check

-- Drop table if partially created and recreate
DROP TABLE IF EXISTS public.ai_agent_profiles;

CREATE TABLE public.ai_agent_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  niche TEXT NOT NULL DEFAULT 'personalizado',
  agent_name TEXT NOT NULL DEFAULT 'Assistente IA',
  agent_role TEXT NOT NULL DEFAULT 'pre-vendas',
  personality TEXT NOT NULL DEFAULT 'equilibrada',
  tone TEXT NOT NULL DEFAULT 'profissional',
  business_description TEXT,
  products_services JSONB DEFAULT '[]'::jsonb,
  rules JSONB DEFAULT '{}'::jsonb,
  funnel_rules JSONB DEFAULT '{}'::jsonb,
  examples JSONB DEFAULT '[]'::jsonb,
  response_time TEXT NOT NULL DEFAULT '20-40',
  questions_per_message INTEGER NOT NULL DEFAULT 1,
  response_length TEXT NOT NULL DEFAULT 'media',
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_agent_profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: org members
CREATE POLICY "Users can view their org AI profiles"
  ON public.ai_agent_profiles FOR SELECT
  USING (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
  );

-- INSERT: admins only (check user_roles table)
CREATE POLICY "Admins can insert AI profiles"
  ON public.ai_agent_profiles FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p 
      WHERE p.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- UPDATE: admins only
CREATE POLICY "Admins can update AI profiles"
  ON public.ai_agent_profiles FOR UPDATE
  USING (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p 
      WHERE p.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

CREATE INDEX idx_ai_agent_profiles_org_active 
  ON public.ai_agent_profiles(organization_id, is_active);

CREATE TRIGGER update_ai_agent_profiles_updated_at
  BEFORE UPDATE ON public.ai_agent_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
