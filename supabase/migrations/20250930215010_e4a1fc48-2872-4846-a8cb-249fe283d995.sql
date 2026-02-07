-- Adicionar campo para admin específico no modo manual
ALTER TABLE lead_distribution_settings 
ADD COLUMN manual_assigned_user_id uuid REFERENCES profiles(id);

COMMENT ON COLUMN lead_distribution_settings.manual_assigned_user_id IS 'Admin específico que receberá os leads no modo manual';