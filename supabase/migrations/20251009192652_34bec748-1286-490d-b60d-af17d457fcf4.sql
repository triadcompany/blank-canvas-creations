-- Corrigir função distribute_lead para round-robin funcionar corretamente
CREATE OR REPLACE FUNCTION public.distribute_lead(p_lead_id uuid, p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_settings lead_distribution_settings%ROWTYPE;
  v_users uuid[];
  v_cursor integer;
  v_assigned_user_id uuid;
  v_next_cursor integer;
  v_assignment_exists boolean;
  v_user_count integer;
  v_lock_acquired boolean;
BEGIN
  -- Usar advisory lock específico para esta organização
  SELECT pg_try_advisory_xact_lock(hashtext('lead_distribution_' || p_organization_id::text)) INTO v_lock_acquired;
  
  IF NOT v_lock_acquired THEN
    RAISE WARNING 'Could not acquire advisory lock for organization %, retrying...', p_organization_id;
    -- Esperar um pouco e tentar novamente
    PERFORM pg_sleep(0.1);
    SELECT pg_try_advisory_xact_lock(hashtext('lead_distribution_' || p_organization_id::text)) INTO v_lock_acquired;
    
    IF NOT v_lock_acquired THEN
      RAISE EXCEPTION 'Could not acquire lock for lead distribution after retry';
    END IF;
  END IF;
  
  RAISE NOTICE '🔒 Lock acquired for organization % at %', p_organization_id, now();
  
  -- 1) Verificar se já existe atribuição (idempotência)
  SELECT EXISTS(
    SELECT 1 FROM lead_assignment WHERE lead_id = p_lead_id
  ) INTO v_assignment_exists;
  
  IF v_assignment_exists THEN
    RAISE NOTICE '✅ Lead % already assigned, skipping', p_lead_id;
    RETURN jsonb_build_object(
      'ok', true,
      'already_assigned', true,
      'message', 'Lead já atribuído anteriormente'
    );
  END IF;
  
  -- 2) Carregar configurações COM LOCK
  SELECT * INTO v_settings
  FROM lead_distribution_settings
  WHERE organization_id = p_organization_id
    AND is_auto_distribution_enabled = true
  FOR UPDATE  -- Lock na linha para garantir consistência
  LIMIT 1;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Distribuição desabilitada ou não configurada';
  END IF;
  
  RAISE NOTICE '📋 Distribution settings loaded: mode=%, cursor=%', v_settings.mode, v_settings.rr_cursor;
  
  -- 3) Determinar usuário baseado no modo
  IF v_settings.mode = 'manual' THEN
    -- Modo manual: atribuir ao receptor manual
    IF v_settings.manual_receiver_id IS NULL THEN
      RAISE EXCEPTION 'Receptor manual não configurado';
    END IF;
    
    v_assigned_user_id := v_settings.manual_receiver_id;
    RAISE NOTICE '👤 Manual mode: assigned to %', v_assigned_user_id;
    
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
    
    -- Obter contagem de usuários
    v_user_count := array_length(v_users, 1);
    RAISE NOTICE '👥 Found % active users for round-robin', v_user_count;
    
    -- Obter cursor atual e garantir que está no range válido
    v_cursor := COALESCE(v_settings.rr_cursor, 0);
    v_cursor := v_cursor % v_user_count;
    
    RAISE NOTICE '🎯 Current cursor: % (of % users)', v_cursor, v_user_count;
    
    -- Selecionar usuário atual (arrays em PL/pgSQL são 1-based)
    v_assigned_user_id := v_users[v_cursor + 1];
    
    RAISE NOTICE '✨ Selected user at position %: %', v_cursor, v_assigned_user_id;
    
    -- Calcular próximo cursor (incrementa e faz módulo para circular)
    v_next_cursor := (v_cursor + 1) % v_user_count;
    
    -- CRÍTICO: Atualizar cursor IMEDIATAMENTE
    UPDATE lead_distribution_settings
    SET rr_cursor = v_next_cursor,
        updated_at = now()
    WHERE id = v_settings.id;
    
    -- Verificar se atualização funcionou
    DECLARE
      v_updated_cursor integer;
    BEGIN
      SELECT rr_cursor INTO v_updated_cursor
      FROM lead_distribution_settings
      WHERE id = v_settings.id;
      
      RAISE NOTICE '🔄 Cursor updated: % -> % (verified: %)', v_cursor, v_next_cursor, v_updated_cursor;
      
      IF v_updated_cursor != v_next_cursor THEN
        RAISE WARNING '⚠️ Cursor update verification failed! Expected %, got %', v_next_cursor, v_updated_cursor;
      END IF;
    END;
    
  ELSE
    RAISE EXCEPTION 'Modo de distribuição inválido: %', v_settings.mode;
  END IF;
  
  -- 4) Criar atribuição (unique constraint garante unicidade)
  INSERT INTO lead_assignment(lead_id, assigned_user_id)
  VALUES (p_lead_id, v_assigned_user_id);
  
  RAISE NOTICE '✅ Assignment created: lead=%, user=%', p_lead_id, v_assigned_user_id;
  
  -- 5) Atualizar seller_id do lead
  UPDATE leads
  SET seller_id = (
    SELECT id FROM profiles WHERE user_id = v_assigned_user_id LIMIT 1
  )
  WHERE id = p_lead_id;
  
  -- 6) Registrar auditoria DETALHADA
  INSERT INTO lead_distribution_audit(event, data)
  VALUES (
    'lead.assigned',
    jsonb_build_object(
      'lead_id', p_lead_id,
      'assigned_user_id', v_assigned_user_id,
      'mode', v_settings.mode,
      'cursor_before', v_cursor,
      'cursor_after', v_next_cursor,
      'user_count', v_user_count,
      'user_list', v_users,
      'timestamp', now(),
      'organization_id', p_organization_id
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
  
  -- 8) Chamar edge function para notificação via WhatsApp (assíncrono)
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
  
  RAISE NOTICE '🎉 Distribution completed successfully for lead %', p_lead_id;
  
  RETURN jsonb_build_object(
    'ok', true,
    'assigned_user_id', v_assigned_user_id,
    'mode', v_settings.mode,
    'cursor_used', v_cursor,
    'next_cursor', v_next_cursor
  );
END;
$function$;

-- Adicionar constraint UNIQUE em lead_assignment para garantir idempotência
ALTER TABLE lead_assignment DROP CONSTRAINT IF EXISTS lead_assignment_lead_id_key;
ALTER TABLE lead_assignment ADD CONSTRAINT lead_assignment_lead_id_key UNIQUE (lead_id);

-- Comentários para documentação
COMMENT ON FUNCTION public.distribute_lead IS 'Distribui leads para usuários usando round-robin ou modo manual. Versão corrigida com logging detalhado e controle de concorrência melhorado.';