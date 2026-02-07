-- =============================================
-- FIX: Criar trigger para novos usuários
-- Execute isso no SQL Editor do Supabase
-- =============================================

-- Primeiro remover trigger se existir
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Criar o trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Verificar se foi criado
SELECT 
  tgname as trigger_name,
  tgrelid::regclass as table_name
FROM pg_trigger 
WHERE tgname = 'on_auth_user_created';
