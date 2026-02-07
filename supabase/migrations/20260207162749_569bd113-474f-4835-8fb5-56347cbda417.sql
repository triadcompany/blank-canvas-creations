-- 1. Tornar clerk_user_id NOT NULL e adicionar índice único na tabela profiles
-- Primeiro, adicionar valor default para registros existentes que não têm clerk_user_id
UPDATE public.profiles 
SET clerk_user_id = user_id::text 
WHERE clerk_user_id IS NULL;

-- Tornar clerk_user_id NOT NULL
ALTER TABLE public.profiles 
ALTER COLUMN clerk_user_id SET NOT NULL;

-- Adicionar índice único se não existir
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_clerk_user_id 
ON public.profiles(clerk_user_id);

-- 2. Tornar user_id nullable (já que usaremos clerk_user_id como referência principal)
ALTER TABLE public.profiles 
ALTER COLUMN user_id DROP NOT NULL;

-- 3. Fazer o mesmo para user_roles
UPDATE public.user_roles 
SET clerk_user_id = user_id::text 
WHERE clerk_user_id IS NULL;

ALTER TABLE public.user_roles 
ALTER COLUMN clerk_user_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_clerk_user_id 
ON public.user_roles(clerk_user_id);

-- Tornar user_id nullable em user_roles
ALTER TABLE public.user_roles 
ALTER COLUMN user_id DROP NOT NULL;

-- 4. Criar políticas RLS para profiles que funcionem com Clerk
-- Primeiro, remover políticas existentes se houver
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by organization" ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Enable update access for users based on clerk_user_id" ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Anyone can read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Anyone can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Anyone can update profiles" ON public.profiles;

-- Como estamos usando Clerk (não Supabase Auth), permitir acesso público às tabelas
-- A segurança será feita a nível de aplicação validando o token do Clerk
-- Habilitar RLS mas com políticas permissivas para leitura/escrita
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Política: Permitir leitura de profiles (a validação do Clerk é feita no app)
CREATE POLICY "Allow public read on profiles" 
ON public.profiles 
FOR SELECT 
USING (true);

-- Política: Permitir insert de profiles
CREATE POLICY "Allow public insert on profiles" 
ON public.profiles 
FOR INSERT 
WITH CHECK (true);

-- Política: Permitir update de profiles
CREATE POLICY "Allow public update on profiles" 
ON public.profiles 
FOR UPDATE 
USING (true);

-- 5. Fazer o mesmo para user_roles
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert own role" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.user_roles;
DROP POLICY IF EXISTS "Anyone can read roles" ON public.user_roles;
DROP POLICY IF EXISTS "Anyone can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Anyone can update roles" ON public.user_roles;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on user_roles" 
ON public.user_roles 
FOR SELECT 
USING (true);

CREATE POLICY "Allow public insert on user_roles" 
ON public.user_roles 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow public update on user_roles" 
ON public.user_roles 
FOR UPDATE 
USING (true);

-- 6. Fazer o mesmo para organizations
DROP POLICY IF EXISTS "Users can view their organization" ON public.organizations;
DROP POLICY IF EXISTS "Admins can update their organization" ON public.organizations;
DROP POLICY IF EXISTS "Anyone can read organizations" ON public.organizations;
DROP POLICY IF EXISTS "Anyone can insert organizations" ON public.organizations;
DROP POLICY IF EXISTS "Anyone can update organizations" ON public.organizations;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on organizations" 
ON public.organizations 
FOR SELECT 
USING (true);

CREATE POLICY "Allow public insert on organizations" 
ON public.organizations 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow public update on organizations" 
ON public.organizations 
FOR UPDATE 
USING (true);