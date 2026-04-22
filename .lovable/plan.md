
## Adicionar botão "Limpar configuração" no WhatsApp (Evolution API)

Adicionar uma ação que reseta completamente a integração WhatsApp da organização, deixando a tela como se nunca tivesse sido configurada (volta ao formulário inicial de criação de instância).

### Comportamento

1. Novo botão **"Limpar configuração"** (variante `outline` com ícone de lixeira) na tela de "Instância não encontrada", ao lado de "Tentar novamente" e "Criar outra instância".
2. Ao clicar, abre um `AlertDialog` de confirmação ("Tem certeza? Isso vai remover a configuração atual da Evolution para esta organização.").
3. Confirmando:
   - Atualiza o registro em `whatsapp_integrations` da organização: `is_active = false`, `instance_name = null`, `qr_code = null`, `metadata = {}`, `phone_number = null`.
   - Limpa estado local: `setIntegration(null)`, `setInstanceName("")`, `setLiveStatus(null)`, `setInstanceFound(true)`, `setQrCode(null)`.
   - Toast de sucesso: "Configuração limpa. Você pode criar uma nova instância."
   - Tela volta ao formulário inicial vazio de "Criar instância".

### Detalhes técnicos

- Arquivo único: `src/components/settings/EvolutionIntegration.tsx`.
- Reaproveitar a função `handleCreateNewInstance` existente, renomeando-a internamente OU criando `handleClearConfiguration` separada que faz o reset completo (mais agressivo: também zera `instance_name` no banco, hoje `handleCreateNewInstance` apenas desativa).
- Usar `AlertDialog` do shadcn (já presente em `src/components/ui/alert-dialog.tsx`).
- Não chamar a Evolution API — é uma limpeza puramente local + Supabase.
- Após o reset, o componente naturalmente renderiza o formulário inicial de criação porque `integration` fica `null`.

### Arquivos editados

- `src/components/settings/EvolutionIntegration.tsx`
