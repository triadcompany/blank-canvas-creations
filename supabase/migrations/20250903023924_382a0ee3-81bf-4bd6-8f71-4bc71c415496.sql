-- Create organizations table for car dealerships
CREATE TABLE public.organizations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj TEXT UNIQUE,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on organizations
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Add organization_id to profiles table
ALTER TABLE public.profiles ADD COLUMN organization_id UUID REFERENCES public.organizations(id);

-- Add organization_id to leads table  
ALTER TABLE public.leads ADD COLUMN organization_id UUID REFERENCES public.organizations(id);

-- Create vehicles table for car inventory
CREATE TABLE public.vehicles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL,
  fuel_type TEXT,
  transmission TEXT,
  mileage INTEGER,
  color TEXT,
  price DECIMAL(12,2),
  status TEXT NOT NULL DEFAULT 'available',
  description TEXT,
  images TEXT[],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES public.profiles(id)
);

-- Enable RLS on vehicles
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- Create updated_at triggers
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vehicles_updated_at
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to get user's organization
CREATE OR REPLACE FUNCTION public.get_user_organization_id(user_uuid uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE user_id = user_uuid;
$$;

-- Organizations policies
CREATE POLICY "Users can view their own organization" 
ON public.organizations 
FOR SELECT 
USING (id = get_user_organization_id(auth.uid()));

CREATE POLICY "Admins can update their organization" 
ON public.organizations 
FOR UPDATE 
USING (id = get_user_organization_id(auth.uid()) AND get_user_role(auth.uid()) = 'admin');

-- Update profiles policies to include organization filtering
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;

CREATE POLICY "Admins can view organization profiles" 
ON public.profiles 
FOR SELECT 
USING (
  get_user_role(auth.uid()) = 'admin' 
  AND organization_id = get_user_organization_id(auth.uid())
);

CREATE POLICY "Admins can update organization profiles" 
ON public.profiles 
FOR UPDATE 
USING (
  get_user_role(auth.uid()) = 'admin' 
  AND organization_id = get_user_organization_id(auth.uid())
);

CREATE POLICY "Admins can insert organization profiles" 
ON public.profiles 
FOR INSERT 
WITH CHECK (
  get_user_role(auth.uid()) = 'admin' 
  AND organization_id = get_user_organization_id(auth.uid())
);

-- Update leads policies to include organization filtering
DROP POLICY IF EXISTS "Admins can view all leads" ON public.leads;
DROP POLICY IF EXISTS "Admins can manage all leads" ON public.leads;
DROP POLICY IF EXISTS "Sellers can view their own leads" ON public.leads;
DROP POLICY IF EXISTS "Sellers can update their own leads" ON public.leads;
DROP POLICY IF EXISTS "Sellers can create leads" ON public.leads;

CREATE POLICY "Admins can view organization leads" 
ON public.leads 
FOR SELECT 
USING (
  (get_user_role(auth.uid()) = 'admin' AND organization_id = get_user_organization_id(auth.uid()))
  OR 
  (seller_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()))
);

CREATE POLICY "Admins can manage organization leads" 
ON public.leads 
FOR ALL 
USING (
  get_user_role(auth.uid()) = 'admin' 
  AND organization_id = get_user_organization_id(auth.uid())
);

CREATE POLICY "Sellers can view organization leads" 
ON public.leads 
FOR SELECT 
USING (
  seller_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  AND organization_id = get_user_organization_id(auth.uid())
);

CREATE POLICY "Sellers can update organization leads" 
ON public.leads 
FOR UPDATE 
USING (
  seller_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  AND organization_id = get_user_organization_id(auth.uid())
);

CREATE POLICY "Sellers can create organization leads" 
ON public.leads 
FOR INSERT 
WITH CHECK (
  seller_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  AND created_by IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  AND organization_id = get_user_organization_id(auth.uid())
);

-- Vehicles policies
CREATE POLICY "Organization members can view vehicles" 
ON public.vehicles 
FOR SELECT 
USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Admins can manage organization vehicles" 
ON public.vehicles 
FOR ALL 
USING (
  get_user_role(auth.uid()) = 'admin' 
  AND organization_id = get_user_organization_id(auth.uid())
);

CREATE POLICY "Sellers can create organization vehicles" 
ON public.vehicles 
FOR INSERT 
WITH CHECK (
  organization_id = get_user_organization_id(auth.uid())
  AND created_by IN (SELECT id FROM profiles WHERE user_id = auth.uid())
);

-- Insert some sample organizations for testing
INSERT INTO public.organizations (name, cnpj, city, state) VALUES 
('Auto Center JK', '12.345.678/0001-90', 'São Paulo', 'SP'),
('Carros Premium Ltda', '98.765.432/0001-10', 'Rio de Janeiro', 'RJ'),
('Mega Veículos', '11.222.333/0001-44', 'Belo Horizonte', 'MG');