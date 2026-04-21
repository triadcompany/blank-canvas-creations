-- Remove org_members órfãos: aqueles cujo profile já foi excluído
DELETE FROM public.org_members om
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.clerk_user_id = om.clerk_user_id
);

-- Remove users_profile órfãos: aqueles sem profile correspondente
DELETE FROM public.users_profile up
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.clerk_user_id = up.clerk_user_id
);

-- Limpa user_roles órfãos
DELETE FROM public.user_roles ur
WHERE ur.clerk_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.clerk_user_id = ur.clerk_user_id
  );