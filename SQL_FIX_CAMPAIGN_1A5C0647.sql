-- =============================================
-- FIX: Campanha presa 1a5c0647-d9b6-4a9e-aec9-a7268cfd1d29
-- Status: 'running' com broadcast_recipients vazio
-- Causa: recipients não foram inseridos (lista com phones
--         inválidos ou erro de rede) + worker quebrou pelo
--         bug de timezone (já corrigido na edge function).
-- =============================================

-- 1. Confirmar o estado atual
SELECT
  id,
  name,
  status,
  payload_type,
  source_type,
  created_at
FROM broadcast_campaigns
WHERE id = '1a5c0647-d9b6-4a9e-aec9-a7268cfd1d29';

-- 2. Confirmar que não há recipients
SELECT COUNT(*) AS total_recipients
FROM broadcast_recipients
WHERE campaign_id = '1a5c0647-d9b6-4a9e-aec9-a7268cfd1d29';

-- 3. Marcar como cancelada (sem recipients, não há nada para enviar)
--    Execute esta linha SOMENTE após confirmar que o total acima é 0:
UPDATE broadcast_campaigns
SET status = 'canceled'
WHERE id = '1a5c0647-d9b6-4a9e-aec9-a7268cfd1d29'
  AND status = 'running';

-- 4. Verificar resultado
SELECT id, name, status FROM broadcast_campaigns
WHERE id = '1a5c0647-d9b6-4a9e-aec9-a7268cfd1d29';
