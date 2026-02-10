
-- 1) Tabela whatsapp_threads
CREATE TABLE public.whatsapp_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
  instance_name text NOT NULL,
  contact_phone_e164 text NOT NULL,
  contact_name text,
  status text NOT NULL DEFAULT 'open',
  assigned_user_id uuid,
  assigned_at timestamptz,
  last_message_at timestamptz DEFAULT now(),
  last_message_preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_threads_org_last_msg ON public.whatsapp_threads (organization_id, last_message_at DESC);
CREATE INDEX idx_whatsapp_threads_phone ON public.whatsapp_threads (organization_id, contact_phone_e164);
CREATE INDEX idx_whatsapp_threads_assigned ON public.whatsapp_threads (assigned_user_id) WHERE assigned_user_id IS NOT NULL;

-- 2) Adicionar thread_id em whatsapp_messages
ALTER TABLE public.whatsapp_messages ADD COLUMN thread_id uuid REFERENCES public.whatsapp_threads(id) ON DELETE SET NULL;
CREATE INDEX idx_whatsapp_messages_thread ON public.whatsapp_messages (thread_id, created_at);

-- 3) RLS whatsapp_threads
ALTER TABLE public.whatsapp_threads ENABLE ROW LEVEL SECURITY;

-- Admin: full access na org
CREATE POLICY "Org admins can manage threads"
  ON public.whatsapp_threads FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    organization_id = public.get_user_organization_id(auth.uid())
    AND public.has_role(auth.uid(), 'admin')
  );

-- Seller: apenas threads atribuídas
CREATE POLICY "Sellers can view assigned threads"
  ON public.whatsapp_threads FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_organization_id(auth.uid())
    AND assigned_user_id = auth.uid()
    AND public.has_role(auth.uid(), 'seller')
  );

CREATE POLICY "Sellers can update assigned threads"
  ON public.whatsapp_threads FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_organization_id(auth.uid())
    AND assigned_user_id = auth.uid()
    AND public.has_role(auth.uid(), 'seller')
  )
  WITH CHECK (
    organization_id = public.get_user_organization_id(auth.uid())
    AND assigned_user_id = auth.uid()
    AND public.has_role(auth.uid(), 'seller')
  );

-- Service role
CREATE POLICY "Service role manages threads"
  ON public.whatsapp_threads FOR ALL USING (true) WITH CHECK (true);

-- 4) RLS adicional para whatsapp_messages (thread-based)
CREATE POLICY "Sellers can view messages of assigned threads"
  ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM profiles WHERE user_id = auth.uid())
    AND (
      public.has_role(auth.uid(), 'admin')
      OR thread_id IN (SELECT id FROM public.whatsapp_threads WHERE assigned_user_id = auth.uid())
    )
  );

CREATE POLICY "Users can insert messages in assigned threads"
  ON public.whatsapp_messages FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM profiles WHERE user_id = auth.uid())
    AND (
      public.has_role(auth.uid(), 'admin')
      OR thread_id IN (SELECT id FROM public.whatsapp_threads WHERE assigned_user_id = auth.uid())
    )
  );

-- 5) Trigger updated_at
CREATE OR REPLACE FUNCTION public.update_whatsapp_thread_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_whatsapp_threads_updated_at
  BEFORE UPDATE ON public.whatsapp_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_whatsapp_thread_updated_at();
