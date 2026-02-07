-- Corrigir inconsistências: user_roles é a fonte da verdade
-- Atualizar profiles.role para corresponder a user_roles.role

UPDATE profiles p
SET role = ur.role
FROM user_roles ur
WHERE p.user_id = ur.user_id
  AND p.role != ur.role;