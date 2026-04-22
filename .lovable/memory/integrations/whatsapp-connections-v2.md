---
name: WhatsApp Connections v2
description: Nova arquitetura de conexão WhatsApp via tabela whatsapp_connections, substituindo whatsapp_integrations
type: feature
---
A conexão do WhatsApp via Evolution API foi refeita usando a tabela `whatsapp_connections` (substitui `whatsapp_integrations` para a UI de conexão; tabelas legadas como `whatsapp_messages`, `whatsapp_threads`, `whatsapp_first_touch` permanecem intactas).

**Schema:** organization_id (FK organizations), instance_name UNIQUE, phone_number, status (disconnected/connecting/connected/error), qr_code, connected_at, last_connected_at, last_disconnected_at, mirror_enabled, mirror_enabled_at, evolution_api_key, created_by_clerk_user_id. Índice único parcial garante apenas 1 conexão ativa (connected/connecting) por org.

**Edge Functions (verify_jwt=false, usam x-clerk-user-id):**
- `whatsapp-connect`: valida admin, cria instância Evolution `autolead_{orgId}_{ts}`, registra QR
- `whatsapp-status`: live check Evolution + sincronização com DB, suporta refresh_qr
- `whatsapp-disconnect`: logout + delete na Evolution, marca disconnected (preserva histórico)
- `whatsapp-webhook-v2`: recebe CONNECTION_UPDATE/MESSAGES_UPSERT (mensagens continuam sendo processadas pelo `evolution-webhook` legado)

**RLS:** members SELECT da própria org via get_my_org_id(); admins ALL via get_my_role()='admin'; service_role bypass.

**UI (EvolutionIntegration.tsx):** 4 estados — sem conexão, connecting (QR + polling 3s + refresh após 2min), connected (número, datas, toggle mirror_enabled, desconectar), disconnected (reconectar preservando histórico). Reset de estado por orgId via lastOrgRef previne vazamento entre organizações.
