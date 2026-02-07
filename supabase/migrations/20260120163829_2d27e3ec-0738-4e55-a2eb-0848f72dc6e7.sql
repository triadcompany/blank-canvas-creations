-- Adicionar campos financeiros e de localização na tabela leads
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS valor_negocio NUMERIC(12, 2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS servico TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS cidade TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS estado VARCHAR(2) DEFAULT NULL;

-- Criar índice para consultas de receita por estado/cidade
CREATE INDEX IF NOT EXISTS idx_leads_localizacao ON public.leads(estado, cidade);

-- Criar índice para consultas de receita
CREATE INDEX IF NOT EXISTS idx_leads_valor_negocio ON public.leads(valor_negocio) WHERE valor_negocio IS NOT NULL;

-- Comentários para documentação
COMMENT ON COLUMN public.leads.valor_negocio IS 'Valor do negócio em reais (R$)';
COMMENT ON COLUMN public.leads.servico IS 'Serviço ou produto de interesse do lead';
COMMENT ON COLUMN public.leads.cidade IS 'Cidade do lead';
COMMENT ON COLUMN public.leads.estado IS 'UF (sigla do estado brasileiro)';