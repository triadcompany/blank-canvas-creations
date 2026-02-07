-- Resetar senha para o usuário específico que está com problema
-- Isso deve permitir que o usuário faça login com a senha que ele digitou
UPDATE auth.users 
SET encrypted_password = crypt('Glmu9671@', gen_salt('bf'))
WHERE email = 'toflyprospeccao@gmail.com';