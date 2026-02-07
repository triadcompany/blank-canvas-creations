-- Corrigir inconsistências: profiles.role é a fonte da verdade
-- Atualizar user_roles.role para corresponder ao profiles.role

UPDATE user_roles ur
SET role = p.role
FROM profiles p
WHERE p.user_id = ur.user_id
  AND p.role != ur.role;