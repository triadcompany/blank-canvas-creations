-- =============================================
-- FIX: Corrigir campanhas/destinatários presos
-- Causado pelo bug do loop síncrono com timeout.
-- Execute no SQL Editor do Supabase ANTES de
-- fazer o deploy da nova edge function.
-- =============================================

-- 1. Liberar recipients presos em 'sending' há mais de 10 minutos
--    (significa que a edge function morreu no meio do envio)
UPDATE broadcast_recipients
SET
  status  = 'pending',
  error   = NULL
WHERE
  status     = 'sending'
  AND created_at < NOW() - INTERVAL '10 minutes';

-- Verificar quantos foram liberados
SELECT
  campaign_id,
  COUNT(*) AS liberados
FROM broadcast_recipients
WHERE
  status     = 'pending'
  AND error IS NULL
GROUP BY campaign_id;

-- 2. Reativar campanhas 'running' que têm destinatários 'pending'
--    mas ficaram paralisadas (worker morreu sem re-invocar)
--    Não precisa alterar status — as campanhas já estão 'running'.
--    Apenas confirmar quais precisam ser re-disparadas manualmente
--    (botão "Retomar" na UI) até que o deploy seja feito:
SELECT
  bc.id            AS campaign_id,
  bc.name,
  bc.status,
  COUNT(br.id)     AS pending_recipients
FROM broadcast_campaigns bc
JOIN broadcast_recipients br
  ON br.campaign_id = bc.id
 AND br.status      = 'pending'
WHERE bc.status = 'running'
GROUP BY bc.id, bc.name, bc.status
ORDER BY bc.created_at DESC;
