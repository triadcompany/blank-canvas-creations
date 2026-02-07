-- Remove o campo role da tabela profiles para evitar confusão
-- A fonte única de verdade para roles deve ser a tabela user_roles

ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;

-- Adicionar comentário na tabela user_roles para documentar que é a fonte de verdade
COMMENT ON TABLE public.user_roles IS 'Tabela de papéis dos usuários - FONTE ÚNICA DE VERDADE para permissões. Nunca use o campo role de outras tabelas.';