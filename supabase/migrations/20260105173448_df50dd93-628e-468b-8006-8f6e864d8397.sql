-- Tabela para armazenar prospects extraídos por CNPJ
CREATE TABLE public.prospects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cnpj TEXT NOT NULL,
  company_name TEXT,
  trade_name TEXT,
  owner_name TEXT,
  owner_phone TEXT,
  owner_email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  status TEXT,
  main_activity TEXT,
  raw_data JSONB,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(organization_id, cnpj)
);

-- Enable RLS
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Users can view prospects from their organization"
ON public.prospects
FOR SELECT
USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Users can insert prospects in their organization"
ON public.prospects
FOR INSERT
WITH CHECK (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Users can update prospects in their organization"
ON public.prospects
FOR UPDATE
USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Users can delete prospects in their organization"
ON public.prospects
FOR DELETE
USING (organization_id = get_user_organization_id(auth.uid()));

-- Trigger para updated_at
CREATE TRIGGER update_prospects_updated_at
BEFORE UPDATE ON public.prospects
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Index para busca rápida
CREATE INDEX idx_prospects_organization ON public.prospects(organization_id);
CREATE INDEX idx_prospects_cnpj ON public.prospects(cnpj);