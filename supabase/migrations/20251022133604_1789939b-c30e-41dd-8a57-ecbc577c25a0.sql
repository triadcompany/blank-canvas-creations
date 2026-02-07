-- Corrigir foreign key constraint para permitir exclusão de leads
-- Primeiro, remover a constraint antiga
ALTER TABLE lead_inbox 
DROP CONSTRAINT IF EXISTS lead_inbox_lead_id_fkey;

-- Recriar a constraint com ON DELETE CASCADE
ALTER TABLE lead_inbox 
ADD CONSTRAINT lead_inbox_lead_id_fkey 
FOREIGN KEY (lead_id) 
REFERENCES leads(id) 
ON DELETE CASCADE;