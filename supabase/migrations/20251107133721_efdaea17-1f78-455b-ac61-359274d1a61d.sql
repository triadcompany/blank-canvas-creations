-- Criar uma view que combina profiles com seus roles
-- Isso facilita visualizar os dados no Supabase Dashboard
-- sem comprometer a segurança (roles continuam na tabela separada)

CREATE OR REPLACE VIEW public.profiles_with_roles AS
SELECT 
  p.id,
  p.user_id,
  p.name,
  p.email,
  p.organization_id,
  p.avatar_url,
  p.whatsapp_e164,
  ur.role,
  p.created_at,
  p.updated_at
FROM public.profiles p
LEFT JOIN public.user_roles ur ON ur.user_id = p.user_id;

-- Permitir que usuários autenticados vejam a view
GRANT SELECT ON public.profiles_with_roles TO authenticated;

-- Adicionar RLS policy para a view
ALTER VIEW public.profiles_with_roles SET (security_invoker = true);

COMMENT ON VIEW public.profiles_with_roles IS 'View que combina profiles com roles para facilitar visualização. Os roles continuam armazenados de forma segura na tabela user_roles separada.';