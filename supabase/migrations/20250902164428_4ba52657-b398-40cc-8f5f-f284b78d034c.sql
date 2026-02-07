-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'seller');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role public.app_role NOT NULL DEFAULT 'seller',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create pipeline_stages table
CREATE TABLE public.pipeline_stages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(position)
);

-- Create leads table
CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  seller_id UUID NOT NULL REFERENCES public.profiles(id),
  source TEXT,
  interest TEXT,
  observations TEXT,
  stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Create function to check user role
CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid UUID)
RETURNS public.app_role
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE user_id = user_uuid;
$$;

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', NEW.email),
    NEW.email,
    'seller'
  );
  RETURN NEW;
END;
$$;

-- Create trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for timestamp updates
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pipeline_stages_updated_at
  BEFORE UPDATE ON public.pipeline_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile" 
ON public.profiles FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Users can update their own profile" 
ON public.profiles FOR UPDATE 
USING (user_id = auth.uid());

CREATE POLICY "Admins can view all profiles" 
ON public.profiles FOR SELECT 
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Admins can update all profiles" 
ON public.profiles FOR UPDATE 
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Admins can insert profiles" 
ON public.profiles FOR INSERT 
WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

-- RLS Policies for pipeline_stages
CREATE POLICY "Everyone can view active pipeline stages" 
ON public.pipeline_stages FOR SELECT 
USING (is_active = true);

CREATE POLICY "Admins can manage pipeline stages" 
ON public.pipeline_stages FOR ALL 
USING (public.get_user_role(auth.uid()) = 'admin');

-- RLS Policies for leads
CREATE POLICY "Sellers can view their own leads" 
ON public.leads FOR SELECT 
USING (seller_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Sellers can create leads" 
ON public.leads FOR INSERT 
WITH CHECK (seller_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()) AND created_by IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Sellers can update their own leads" 
ON public.leads FOR UPDATE 
USING (seller_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Admins can view all leads" 
ON public.leads FOR SELECT 
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Admins can manage all leads" 
ON public.leads FOR ALL 
USING (public.get_user_role(auth.uid()) = 'admin');

-- Insert default pipeline stages
INSERT INTO public.pipeline_stages (name, position, color) VALUES
('Novo Lead', 1, '#10B981'),
('Contato Realizado', 2, '#3B82F6'), 
('Proposta Enviada', 3, '#F59E0B'),
('Negociação', 4, '#8B5CF6'),
('Fechado', 5, '#EF4444');