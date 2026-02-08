

# Plano: Corrigir Webhook do Stripe

## Problema Identificado

O webhook está falhando na verificação de assinatura porque o `STRIPE_WEBHOOK_SECRET` no Lovable **não corresponde** ao "Signing Secret" do endpoint configurado no Stripe Dashboard.

Os logs mostram claramente:
```
[STRIPE-WEBHOOK] Webhook signature verification failed
```

Isso impede que qualquer evento do Stripe (como `checkout.session.completed`) grave dados na tabela `subscriptions`.

---

## O Que Você Precisa Fazer (no Stripe Dashboard)

### Passo 1: Acessar o Stripe Dashboard
1. Vá para [https://dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks)
2. Certifique-se de estar no ambiente correto (Live ou Test, dependendo de qual você está usando)

### Passo 2: Verificar/Criar o Endpoint
Você precisa de um endpoint apontando para:
```
https://a0c33aac-48c9-4a84-a72b-1de45dfa93f8.supabase.co/functions/v1/stripe-webhook
```

Se o endpoint **não existir**:
1. Clique em "Add endpoint"
2. Cole a URL acima
3. Selecione os eventos:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Clique em "Add endpoint"

Se o endpoint **já existir**, clique nele para ver os detalhes.

### Passo 3: Copiar o Signing Secret
1. No painel do endpoint, clique em "Reveal" no campo "Signing secret"
2. Copie o valor (começa com `whsec_...`)

### Passo 4: Atualizar o Secret no Lovable
1. No Lovable, vá em **Settings → Secrets**
2. Encontre `STRIPE_WEBHOOK_SECRET`
3. Atualize o valor com o Signing Secret que você copiou
4. Salve

---

## O Que Eu Vou Implementar (melhorias no código)

### 1. Melhorar logs do webhook
Adicionar logs mais detalhados para facilitar debug:
- Logar se o secret está configurado
- Logar o tipo de erro de validação sem expor dados sensíveis

### 2. Ajustar check-subscription
Trocar `.single()` por `.maybeSingle()` para evitar erros quando não houver registro.

### 3. Adicionar sincronização pós-checkout (backup)
Criar função `sync-subscription-from-checkout` que sincroniza a assinatura imediatamente quando o usuário volta do Stripe com `session_id`, garantindo que o plano atualize mesmo se o webhook demorar.

---

## Arquivos a Serem Modificados

| Arquivo | Ação |
|---------|------|
| `supabase/functions/stripe-webhook/index.ts` | Melhorar logs de debug |
| `supabase/functions/check-subscription/index.ts` | Usar `.maybeSingle()` |
| `supabase/functions/sync-subscription-from-checkout/index.ts` | Criar nova função (backup) |
| `src/components/settings/BillingSettings.tsx` | Chamar sync ao voltar do checkout |

---

## Resultado Esperado

Após essas correções:
1. Você atualiza o secret no Lovable com o valor correto do Stripe
2. Ao assinar um plano, o webhook processa com sucesso
3. A tabela `subscriptions` é preenchida com o plano correto
4. Sidebar e perfil mostram "Start" ou "Scale" imediatamente

---

## Seção Técnica

### Estrutura da tabela `subscriptions` (esperada pelo código)

```text
┌─────────────────────────┬──────────────────────────────────────────┐
│ Coluna                  │ Descrição                                │
├─────────────────────────┼──────────────────────────────────────────┤
│ clerk_organization_id   │ ID da organização (do Supabase)          │
│ clerk_user_id           │ ID do usuário Clerk                      │
│ stripe_customer_id      │ ID do cliente no Stripe                  │
│ stripe_subscription_id  │ ID da subscription no Stripe (UNIQUE)    │
│ plan                    │ 'start' | 'scale'                        │
│ billing_cycle           │ 'monthly' | 'yearly'                     │
│ status                  │ 'active' | 'canceled' | 'past_due'       │
│ current_period_start    │ Início do período atual                  │
│ current_period_end      │ Fim do período atual                     │
│ cancel_at_period_end    │ Se vai cancelar no fim do período        │
└─────────────────────────┴──────────────────────────────────────────┘
```

### Fluxo Corrigido

```text
1. Usuário clica "Assinar Start"
2. create-checkout cria sessão no Stripe com metadata
3. Usuário completa pagamento no Stripe
4. Stripe envia evento checkout.session.completed → stripe-webhook
5. stripe-webhook valida assinatura ✓
6. stripe-webhook insere registro na tabela subscriptions
7. Usuário volta para /settings?tab=billing&session_id=...
8. sync-subscription-from-checkout valida e confirma (backup)
9. check-subscription retorna subscribed: true, plan: 'start'
10. UI mostra "Start" na sidebar e no perfil
```

