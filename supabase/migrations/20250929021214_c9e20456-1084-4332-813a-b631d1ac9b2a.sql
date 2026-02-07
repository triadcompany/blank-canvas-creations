-- Criar tabela para origens de leads
CREATE TABLE public.lead_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_lead_source_per_org UNIQUE(organization_id, name)
);

-- Enable RLS
ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view organization lead sources" 
ON public.lead_sources 
FOR SELECT 
USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "Admins can manage organization lead sources" 
ON public.lead_sources 
FOR ALL 
USING ((get_user_role(auth.uid()) = 'admin'::app_role) AND (organization_id = get_user_organization_id(auth.uid())))
WITH CHECK ((get_user_role(auth.uid()) = 'admin'::app_role) AND (organization_id = get_user_organization_id(auth.uid())));

-- Add trigger for updated_at
CREATE TRIGGER update_lead_sources_updated_at
BEFORE UPDATE ON public.lead_sources
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();