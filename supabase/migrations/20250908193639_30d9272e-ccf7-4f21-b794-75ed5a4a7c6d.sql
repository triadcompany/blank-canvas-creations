-- Confirmar automaticamente todos os usuários não confirmados
-- Isso permite que usuários criados possam fazer login imediatamente

UPDATE auth.users 
SET email_confirmed_at = now()
WHERE email_confirmed_at IS NULL;