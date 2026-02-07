-- Criar tabela lead_inbox para receber leads do webhook
CREATE TABLE IF NOT EXISTS public.lead_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE NOT NULL,
  payload jsonb,
  lead_id uuid REFERENCES public.leads(id),
  status text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'atribuido', 'ignorado', 'erro')),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índice para busca rápida por external_id
CREATE INDEX IF NOT EXISTS idx_lead_inbox_external_id ON public.lead_inbox(external_id);
CREATE INDEX IF NOT EXISTS idx_lead_inbox_status ON public.lead_inbox(status);

-- Criar tabela lead_assignment para garantir unicidade de atribuição
CREATE TABLE IF NOT EXISTS public.lead_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  assigned_user_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id) -- Garante que um lead só pode ser atribuído uma vez
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_lead_assignment_lead_id ON public.lead_assignment(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_assignment_user_id ON public.lead_assignment(assigned_user_id);

-- Criar tabela de auditoria
CREATE TABLE IF NOT EXISTS public.lead_distribution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índice para busca por evento e data
CREATE INDEX IF NOT EXISTS idx_lead_audit_event ON public.lead_distribution_audit(event);
CREATE INDEX IF NOT EXISTS idx_lead_audit_created_at ON public.lead_distribution_audit(created_at DESC);

-- Atualizar tabela lead_distribution_settings para suportar ambos os modos
ALTER TABLE public.lead_distribution_settings 
  DROP COLUMN IF EXISTS manual_assigned_user_id;

ALTER TABLE public.lead_distribution_settings 
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'auto'));

ALTER TABLE public.lead_distribution_settings 
  ADD COLUMN IF NOT EXISTS manual_receiver_id uuid;

ALTER TABLE public.lead_distribution_settings 
  ADD COLUMN IF NOT EXISTS rr_cursor integer NOT NULL DEFAULT 0;

-- Atualizar lead_distribution_state para incluir contador
ALTER TABLE public.lead_distribution_state
  ADD COLUMN IF NOT EXISTS assignment_count integer NOT NULL DEFAULT 0;

-- RLS Policies para lead_inbox
ALTER TABLE public.lead_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organization members can view lead inbox"
  ON public.lead_inbox FOR SELECT
  TO authenticated
  USING (
    lead_id IN (
      SELECT id FROM public.leads 
      WHERE organization_id = get_user_organization_id(auth.uid())
    )
  );

-- RLS Policies para lead_assignment
ALTER TABLE public.lead_assignment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organization members can view lead assignments"
  ON public.lead_assignment FOR SELECT
  TO authenticated
  USING (
    lead_id IN (
      SELECT id FROM public.leads 
      WHERE organization_id = get_user_organization_id(auth.uid())
    )
  );

-- RLS Policies para lead_distribution_audit
ALTER TABLE public.lead_distribution_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view distribution audit"
  ON public.lead_distribution_audit FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Função para distribuir leads com lock para concorrência
CREATE OR REPLACE FUNCTION public.distribute_lead(
  p_lead_id uuid,
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings lead_distribution_settings%ROWTYPE;
  v_users uuid[];
  v_cursor integer;
  v_assigned_user_id uuid;
  v_next_cursor integer;
  v_assignment_exists boolean;
BEGIN
  -- Usar advisory lock para garantir que apenas uma thread processe por vez
  PERFORM pg_advisory_xact_lock(hashtext('lead_distribution_' || p_organization_id::text));
  
  -- 1) Verificar se já existe atribuição (idempotência)
  SELECT EXISTS(
    SELECT 1 FROM lead_assignment WHERE lead_id = p_lead_id
  ) INTO v_assignment_exists;
  
  IF v_assignment_exists THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_assigned', true,
      'message', 'Lead já atribuído anteriormente'
    );
  END IF;
  
  -- 2) Carregar configurações
  SELECT * INTO v_settings
  FROM lead_distribution_settings
  WHERE organization_id = p_organization_id
    AND is_auto_distribution_enabled = true
  LIMIT 1;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Distribuição desabilitada ou não configurada';
  END IF;
  
  -- 3) Determinar usuário baseado no modo
  IF v_settings.mode = 'manual' THEN
    -- Modo manual: atribuir ao receptor manual
    IF v_settings.manual_receiver_id IS NULL THEN
      RAISE EXCEPTION 'Receptor manual não configurado';
    END IF;
    
    v_assigned_user_id := v_settings.manual_receiver_id;
    
  ELSIF v_settings.mode = 'auto' THEN
    -- Modo automático: round-robin
    -- Buscar usuários ativos na ordem
    SELECT array_agg(user_id ORDER BY order_position)
    INTO v_users
    FROM lead_distribution_users
    WHERE distribution_setting_id = v_settings.id
      AND is_active = true;
    
    IF v_users IS NULL OR array_length(v_users, 1) = 0 THEN
      RAISE EXCEPTION 'Nenhum usuário selecionado para distribuição automática';
    END IF;
    
    -- Obter cursor atual
    v_cursor := v_settings.rr_cursor;
    
    -- Sanitizar cursor para estar no range válido
    v_cursor := v_cursor % array_length(v_users, 1);
    
    -- Selecionar usuário atual
    v_assigned_user_id := v_users[v_cursor + 1]; -- Arrays em PL/pgSQL são 1-based
    
    -- Calcular próximo cursor
    v_next_cursor := (v_cursor + 1) % array_length(v_users, 1);
    
    -- Atualizar cursor para próxima atribuição
    UPDATE lead_distribution_settings
    SET rr_cursor = v_next_cursor,
        updated_at = now()
    WHERE id = v_settings.id;
    
  ELSE
    RAISE EXCEPTION 'Modo de distribuição inválido: %', v_settings.mode;
  END IF;
  
  -- 4) Criar atribuição (unique constraint garante unicidade)
  INSERT INTO lead_assignment(lead_id, assigned_user_id)
  VALUES (p_lead_id, v_assigned_user_id);
  
  -- 5) Atualizar seller_id do lead
  UPDATE leads
  SET seller_id = (
    SELECT id FROM profiles WHERE user_id = v_assigned_user_id LIMIT 1
  )
  WHERE id = p_lead_id;
  
  -- 6) Registrar auditoria
  INSERT INTO lead_distribution_audit(event, data)
  VALUES (
    'lead.assigned',
    jsonb_build_object(
      'lead_id', p_lead_id,
      'assigned_user_id', v_assigned_user_id,
      'mode', v_settings.mode,
      'timestamp', now()
    )
  );
  
  -- 7) Atualizar estado de distribuição
  INSERT INTO lead_distribution_state(
    distribution_setting_id,
    last_assigned_user_id,
    last_assignment_at,
    assignment_count
  )
  VALUES (
    v_settings.id,
    v_assigned_user_id,
    now(),
    1
  )
  ON CONFLICT (distribution_setting_id)
  DO UPDATE SET
    last_assigned_user_id = EXCLUDED.last_assigned_user_id,
    last_assignment_at = EXCLUDED.last_assignment_at,
    assignment_count = lead_distribution_state.assignment_count + 1,
    updated_at = now();
  
  RETURN jsonb_build_object(
    'ok', true,
    'assigned_user_id', v_assigned_user_id,
    'mode', v_settings.mode
  );
END;
$$;

-- Função para resetar cursor do round-robin
CREATE OR REPLACE FUNCTION public.reset_distribution_cursor(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE lead_distribution_settings
  SET rr_cursor = 0,
      updated_at = now()
  WHERE organization_id = p_organization_id;
  
  INSERT INTO lead_distribution_audit(event, data)
  VALUES (
    'cursor.reset',
    jsonb_build_object(
      'organization_id', p_organization_id,
      'timestamp', now()
    )
  );
END;
$$;