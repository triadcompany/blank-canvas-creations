-- Confirmar automaticamente todos os usuários não confirmados
-- Isso permite que usuários criados possam fazer login imediatamente

UPDATE auth.users 
SET 
  email_confirmed_at = COALESCE(email_confirmed_at, now()),
  confirmed_at = COALESCE(confirmed_at, now())
WHERE email_confirmed_at IS NULL 
   OR confirmed_at IS NULL;

-- Atualizar usuários com emails específicos que vemos nos logs
UPDATE auth.users 
SET 
  email_confirmed_at = now(),
  confirmed_at = now()
WHERE email IN (
  'thiagooextrem67@gmail.com',
  'toflyprospeccao@gmail.com'
);