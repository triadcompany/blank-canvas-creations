-- Desabilitar confirmação de email no Supabase
-- Isso permitirá login imediato após signup sem precisar confirmar email

-- Atualizar configuração de autenticação para permitir login sem confirmação
-- Esta é uma configuração do Supabase que precisa ser aplicada via SQL

UPDATE auth.config SET
  enable_signup = true,
  enable_confirmations = false,
  double_confirm_changes = false
WHERE true;

-- Se a tabela config não existir ou não tiver dados, inserir configuração padrão
INSERT INTO auth.config (enable_signup, enable_confirmations, double_confirm_changes)
SELECT true, false, false
WHERE NOT EXISTS (SELECT 1 FROM auth.config);

-- Confirmar automaticamente todos os usuários existentes que ainda não foram confirmados
UPDATE auth.users 
SET email_confirmed_at = now(), 
    confirmed_at = now()
WHERE email_confirmed_at IS NULL OR confirmed_at IS NULL;