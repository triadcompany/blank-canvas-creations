
-- =============================================
-- 1. intent_definitions: dynamic intent catalog
-- =============================================
CREATE TABLE public.intent_definitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scope_type TEXT NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global', 'niche', 'organization')),
  scope_id TEXT, -- null for global, niche_name for niche, org_id for organization
  intent_key TEXT NOT NULL,
  intent_label TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.intent_definitions ENABLE ROW LEVEL SECURITY;

-- Everyone can read global + niche intents; org-specific only by members
CREATE POLICY "Anyone can read global and niche intents"
  ON public.intent_definitions FOR SELECT
  USING (
    scope_type IN ('global', 'niche')
    OR (
      scope_type = 'organization'
      AND scope_id::uuid IN (
        SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Admins can manage org intents"
  ON public.intent_definitions FOR ALL
  USING (
    scope_type = 'organization'
    AND scope_id::uuid IN (
      SELECT ur.organization_id FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

CREATE INDEX idx_intent_definitions_scope ON public.intent_definitions (scope_type, scope_id);
CREATE UNIQUE INDEX idx_intent_definitions_unique_key ON public.intent_definitions (scope_type, COALESCE(scope_id, '__global__'), intent_key);

-- =============================================
-- 2. conversation_intelligence: latest detection
-- =============================================
CREATE TABLE public.conversation_intelligence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  last_detected_intent TEXT NOT NULL DEFAULT 'unknown',
  intent_label TEXT,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  sentiment TEXT NOT NULL DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  urgency_level TEXT NOT NULL DEFAULT 'low' CHECK (urgency_level IN ('low', 'medium', 'high')),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(conversation_id)
);

ALTER TABLE public.conversation_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read intelligence for their org"
  ON public.conversation_intelligence FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role manages intelligence"
  ON public.conversation_intelligence FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_conversation_intelligence_org ON public.conversation_intelligence (organization_id);
CREATE INDEX idx_conversation_intelligence_conv ON public.conversation_intelligence (conversation_id);

-- =============================================
-- 3. Seed global intent_definitions
-- =============================================
INSERT INTO public.intent_definitions (scope_type, scope_id, intent_key, intent_label) VALUES
  ('global', NULL, 'greeting', 'Saudação'),
  ('global', NULL, 'price_inquiry', 'Interesse em preço'),
  ('global', NULL, 'product_inquiry', 'Interesse em produto/serviço'),
  ('global', NULL, 'scheduling', 'Agendamento'),
  ('global', NULL, 'purchase_interest', 'Interesse de compra'),
  ('global', NULL, 'objection', 'Objeção'),
  ('global', NULL, 'complaint', 'Reclamação'),
  ('global', NULL, 'support_request', 'Solicitação de suporte'),
  ('global', NULL, 'closing', 'Fechamento'),
  ('global', NULL, 'no_interest', 'Sem interesse'),
  ('global', NULL, 'follow_up', 'Follow-up'),
  ('global', NULL, 'unknown', 'Indefinido');

-- Niche: loja_de_carros
INSERT INTO public.intent_definitions (scope_type, scope_id, intent_key, intent_label) VALUES
  ('niche', 'loja_de_carros', 'test_drive', 'Agendamento de test drive'),
  ('niche', 'loja_de_carros', 'financing_inquiry', 'Consulta de financiamento'),
  ('niche', 'loja_de_carros', 'trade_in', 'Troca de veículo');

-- Niche: imobiliaria
INSERT INTO public.intent_definitions (scope_type, scope_id, intent_key, intent_label) VALUES
  ('niche', 'imobiliaria', 'visit_scheduling', 'Agendamento de visita'),
  ('niche', 'imobiliaria', 'location_inquiry', 'Consulta de localização'),
  ('niche', 'imobiliaria', 'documentation_inquiry', 'Dúvida de documentação');

-- Niche: agencia_de_marketing
INSERT INTO public.intent_definitions (scope_type, scope_id, intent_key, intent_label) VALUES
  ('niche', 'agencia_de_marketing', 'portfolio_request', 'Solicitação de portfólio'),
  ('niche', 'agencia_de_marketing', 'budget_inquiry', 'Consulta de orçamento'),
  ('niche', 'agencia_de_marketing', 'results_inquiry', 'Consulta de resultados');
