-- ==========================================
-- CORREÇÃO DEFINITIVA: Distribuição Round-Robin
-- ==========================================
-- Esta migração:
-- 1. Remove TODAS as versões antigas da função distribute_lead
-- 2. Cria versão única com lógica GARANTIDA de incremento
-- 3. Adiciona validação pós-UPDATE do cursor
-- 4. Implementa fallback de segurança

-- Dropar TODAS as versões existentes (cascade para remover dependências)
DROP FUNCTION IF EXISTS public.distribute_lead(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS distribute_lead(uuid, uuid) CASCADE;

-- Recriar função com lógica ROBUSTA e VALIDADA
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
  v_cursor_verified integer;
  v_retry_count integer := 0;
BEGIN
  -- Advisory lock OBRIGATÓRIO para esta organização
  SELECT pg_try_advisory_xact_lock(hashtext('lead_distribution_' || p_organization_id::text)) INTO v_lock_acquired;
  
  IF NOT v_lock_acquired THEN
    RAISE NOTICE '⚠️ Could not acquire advisory lock for organization %, retrying...', p_organization_id;
    PERFORM pg_sleep(0.1);
    SELECT pg_try_advisory_xact_lock(hashtext('lead_distribution_' || p_organization_id::text)) INTO v_lock_acquired;
    
    IF NOT v_lock_acquired THEN
      RAISE EXCEPTION 'Could not acquire lock for lead distribution after retry';
    END IF;
  END IF;
  
  RAISE NOTICE '🔒 Lock acquired for organization % at %', p_organization_id, now();
  
  -- Verificar idempotência
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
  
  -- Carregar configurações COM LOCK FOR UPDATE
  SELECT * INTO v_settings
  FROM lead_distribution_settings
  WHERE organization_id = p_organization_id
    AND is_auto_distribution_enabled = true
  FOR UPDATE
  LIMIT 1;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Distribuição desabilitada ou não configurada';
  END IF;
  
  RAISE NOTICE '📋 [ORG:%] Distribution settings loaded: mode=%, cursor=%', p_organization_id, v_settings.mode, v_settings.rr_cursor;
  
  -- ==========================================
  -- MODO MANUAL
  -- ==========================================
  IF v_settings.mode = 'manual' THEN
    IF v_settings.manual_receiver_id IS NULL THEN
      RAISE EXCEPTION 'Receptor manual não configurado';
    END IF;
    
    v_assigned_user_id := v_settings.manual_receiver_id;
    RAISE NOTICE '👤 [ORG:%] Manual mode: assigned to %', p_organization_id, v_assigned_user_id;
    
  -- ==========================================
  -- MODO AUTO (ROUND-ROBIN)
  -- ==========================================
  ELSIF v_settings.mode = 'auto' THEN
    -- Buscar usuários ativos ordenados por posição
    SELECT array_agg(user_id ORDER BY order_position)
    INTO v_users
    FROM lead_distribution_users
    WHERE distribution_setting_id = v_settings.id
      AND is_active = true;
    
    IF v_users IS NULL OR array_length(v_users, 1) = 0 THEN
      RAISE EXCEPTION 'Nenhum usuário selecionado para distribuição automática';
    END IF;
    
    v_user_count := array_length(v_users, 1);
    RAISE NOTICE '👥 [ORG:%] Found % active users for round-robin', p_organization_id, v_user_count;
    
    -- Obter cursor atual e normalizar
    v_cursor := COALESCE(v_settings.rr_cursor, 0);
    v_cursor := v_cursor % v_user_count;
    
    RAISE NOTICE '🎯 [ORG:%] Current cursor: % (of % users)', p_organization_id, v_cursor, v_user_count;
    
    -- Selecionar usuário (arrays são 1-based em PL/pgSQL)
    v_assigned_user_id := v_users[v_cursor + 1];
    
    RAISE NOTICE '✨ [ORG:%] Selected user at position %: %', p_organization_id, v_cursor, v_assigned_user_id;
    
    -- Calcular próximo cursor
    v_next_cursor := (v_cursor + 1) % v_user_count;
    
    -- ==========================================
    -- CRÍTICO: UPDATE + VERIFICAÇÃO DO CURSOR
    -- ==========================================
    UPDATE lead_distribution_settings
    SET rr_cursor = v_next_cursor,
        updated_at = now()
    WHERE id = v_settings.id;
    
    -- VERIFICAR que o UPDATE funcionou
    SELECT rr_cursor INTO v_cursor_verified
    FROM lead_distribution_settings
    WHERE id = v_settings.id;
    
    IF v_cursor_verified IS NULL OR v_cursor_verified != v_next_cursor THEN
      RAISE WARNING '⚠️⚠️⚠️ [ORG:%] CURSOR UPDATE FAILED! Expected %, got %', 
        p_organization_id, v_next_cursor, v_cursor_verified;
      
      -- Tentar novamente
      UPDATE lead_distribution_settings
      SET rr_cursor = v_next_cursor,
          updated_at = now()
      WHERE id = v_settings.id;
      
      SELECT rr_cursor INTO v_cursor_verified
      FROM lead_distribution_settings
      WHERE id = v_settings.id;
      
      IF v_cursor_verified != v_next_cursor THEN
        RAISE EXCEPTION 'Cursor update failed after retry. This should never happen!';
      END IF;
    END IF;
    
    RAISE NOTICE '🔄 [ORG:%] Cursor updated: % -> % (verified: %)', 
      p_organization_id, v_cursor, v_next_cursor, v_cursor_verified;
    
  ELSE
    RAISE EXCEPTION 'Modo de distribuição inválido: %', v_settings.mode;
  END IF;
  
  -- ==========================================
  -- CRIAR ATRIBUIÇÃO
  -- ==========================================
  INSERT INTO lead_assignment(lead_id, assigned_user_id)
  VALUES (p_lead_id, v_assigned_user_id);
  
  RAISE NOTICE '✅ [ORG:%] Assignment created: lead=%, user=%', p_organization_id, p_lead_id, v_assigned_user_id;
  
  -- Atualizar seller_id do lead
  UPDATE leads
  SET seller_id = (
    SELECT id FROM profiles WHERE user_id = v_assigned_user_id LIMIT 1
  )
  WHERE id = p_lead_id;
  
  -- ==========================================
  -- AUDITORIA DETALHADA
  -- ==========================================
  INSERT INTO lead_distribution_audit(event, data)
  VALUES (
    'lead.assigned',
    jsonb_build_object(
      'lead_id', p_lead_id,
      'assigned_user_id', v_assigned_user_id,
      'mode', v_settings.mode,
      'cursor_before', v_cursor,
      'cursor_after', v_next_cursor,
      'cursor_verified', v_cursor_verified,
      'user_count', v_user_count,
      'user_list', v_users,
      'timestamp', now(),
      'organization_id', p_organization_id,
      'function_version', '2025-10-10-FINAL'
    )
  );
  
  -- Atualizar estado de distribuição
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
  
  -- Notificação via WhatsApp (assíncrono, não bloqueia)
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Notification failed (non-critical): %', SQLERRM;
  END;
  
  RAISE NOTICE '🎉 [ORG:%] Distribution completed successfully for lead %', p_organization_id, p_lead_id;
  
  RETURN jsonb_build_object(
    'ok', true,
    'assigned_user_id', v_assigned_user_id,
    'mode', v_settings.mode,
    'cursor_used', v_cursor,
    'next_cursor', v_next_cursor,
    'cursor_verified', v_cursor_verified,
    'function_version', '2025-10-10-FINAL'
  );
END;
$function$;