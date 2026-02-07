-- Modificar a função distribute_lead para chamar a edge function de notificação
CREATE OR REPLACE FUNCTION public.distribute_lead(p_lead_id uuid, p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  
  -- 8) NOVO: Chamar edge function para notificação via WhatsApp (assíncrono)
  -- Usando pg_net para não bloquear a transação
  PERFORM net.http_post(
    url := 'https://wjfndfamepbjjfggkcua.supabase.co/functions/v1/notify-lead-assignment',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqZm5kZmFtZXBiampmZ2drY3VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4MzAxNTYsImV4cCI6MjA3MjQwNjE1Nn0.G2Rc8js-ZGyEWlr9si12fdcIjZggLgwmEeNhxTT97Zk'
    ),
    body := jsonb_build_object(
      'lead_id', p_lead_id,
      'assigned_user_id', v_assigned_user_id,
      'organization_id', p_organization_id
    )
  );
  
  RETURN jsonb_build_object(
    'ok', true,
    'assigned_user_id', v_assigned_user_id,
    'mode', v_settings.mode
  );
END;
$$;