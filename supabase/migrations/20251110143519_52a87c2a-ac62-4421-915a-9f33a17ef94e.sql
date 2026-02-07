
-- Corrigir role do usuário Eduardo para seller
UPDATE user_roles 
SET role = 'seller', updated_at = now()
WHERE user_id = 'f647acd7-e478-431a-94d6-f6c3ee77afa2';
