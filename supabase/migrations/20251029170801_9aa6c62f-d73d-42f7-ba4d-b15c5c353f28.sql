-- Atualizar role do usuário triadcompanyy@gmail.com para admin
UPDATE user_roles
SET role = 'admin'
WHERE user_id = (
  SELECT user_id 
  FROM profiles 
  WHERE email = 'triadcompanyy@gmail.com'
  LIMIT 1
);

-- Se não existir registro na user_roles, inserir
INSERT INTO user_roles (user_id, role, organization_id)
SELECT 
  p.user_id,
  'admin'::app_role,
  p.organization_id
FROM profiles p
WHERE p.email = 'triadcompanyy@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = p.user_id
  );

-- Atualizar também a coluna role na tabela profiles (se existir)
UPDATE profiles
SET role = 'admin'
WHERE email = 'triadcompanyy@gmail.com';