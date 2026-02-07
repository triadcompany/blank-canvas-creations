-- Criar enum para prioridade de tarefas
CREATE TYPE task_priority AS ENUM ('baixa', 'media', 'alta');

-- Criar enum para status de tarefas
CREATE TYPE task_status AS ENUM ('pendente', 'em_andamento', 'concluida', 'atrasada');

-- Criar tabela de tarefas
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  descricao TEXT,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  responsavel_id UUID NOT NULL REFERENCES profiles(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  data_hora TIMESTAMP WITH TIME ZONE NOT NULL,
  prioridade task_priority NOT NULL DEFAULT 'media',
  status task_status NOT NULL DEFAULT 'pendente',
  notificado BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Habilitar RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Usuários podem ver tarefas da organização"
  ON tasks FOR SELECT
  USING (
    organization_id = get_user_organization_id(auth.uid()) 
    AND (
      responsavel_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
      OR get_user_role(auth.uid()) = 'admin'
    )
  );

CREATE POLICY "Usuários podem criar tarefas na organização"
  ON tasks FOR INSERT
  WITH CHECK (
    organization_id = get_user_organization_id(auth.uid())
    AND responsavel_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Usuários podem atualizar suas tarefas"
  ON tasks FOR UPDATE
  USING (
    organization_id = get_user_organization_id(auth.uid())
    AND (
      responsavel_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
      OR get_user_role(auth.uid()) = 'admin'
    )
  );

CREATE POLICY "Admins podem deletar tarefas da organização"
  ON tasks FOR DELETE
  USING (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) = 'admin'
  );

-- Trigger para atualizar updated_at
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Função para marcar tarefas atrasadas automaticamente
CREATE OR REPLACE FUNCTION mark_overdue_tasks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE tasks
  SET status = 'atrasada'
  WHERE status IN ('pendente', 'em_andamento')
    AND data_hora < now()
    AND status != 'concluida';
END;
$$;

-- Índices para melhor performance
CREATE INDEX idx_tasks_responsavel ON tasks(responsavel_id);
CREATE INDEX idx_tasks_lead ON tasks(lead_id);
CREATE INDEX idx_tasks_organization ON tasks(organization_id);
CREATE INDEX idx_tasks_data_hora ON tasks(data_hora);
CREATE INDEX idx_tasks_status ON tasks(status);