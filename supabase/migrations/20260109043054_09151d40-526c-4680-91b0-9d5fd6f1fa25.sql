-- Adicionar foreign key de seller_id para profiles (o vendedor responsável pelo lead)
ALTER TABLE public.leads 
ADD CONSTRAINT leads_seller_id_fkey 
FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Adicionar foreign key de created_by para profiles (quem criou o lead)
ALTER TABLE public.leads 
ADD CONSTRAINT leads_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Adicionar foreign key de stage_id para pipeline_stages
ALTER TABLE public.leads 
ADD CONSTRAINT leads_stage_id_fkey 
FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;