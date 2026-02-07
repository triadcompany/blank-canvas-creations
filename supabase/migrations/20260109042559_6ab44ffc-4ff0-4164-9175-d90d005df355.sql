
-- Adicionar colunas faltantes na tabela user_invitations
ALTER TABLE public.user_invitations 
ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';

ALTER TABLE public.user_invitations 
ADD COLUMN IF NOT EXISTS name text;

-- Atualizar registros existentes para ter status baseado em accepted_at
UPDATE public.user_invitations 
SET status = CASE 
  WHEN accepted_at IS NOT NULL THEN 'accepted' 
  ELSE 'pending' 
END
WHERE status IS NULL;
