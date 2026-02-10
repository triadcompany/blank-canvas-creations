
-- Create conversations table
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
  instance_name text NOT NULL,
  contact_phone text NOT NULL,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_message_at timestamptz DEFAULT now(),
  unread_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, instance_name, contact_phone)
);

-- Create messages table
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.saas_organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_conversations_org ON public.conversations(organization_id);
CREATE INDEX idx_conversations_org_phone ON public.conversations(organization_id, contact_phone);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX idx_messages_org ON public.messages(organization_id);

-- Enable RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- RLS policies for conversations
CREATE POLICY "Users can view their org conversations"
  ON public.conversations FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can insert their org conversations"
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can update their org conversations"
  ON public.conversations FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can delete their org conversations"
  ON public.conversations FOR DELETE TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- RLS policies for messages
CREATE POLICY "Users can view their org messages"
  ON public.messages FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can insert their org messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can update their org messages"
  ON public.messages FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can delete their org messages"
  ON public.messages FOR DELETE TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- Service role bypass for edge functions
CREATE POLICY "Service role full access conversations"
  ON public.conversations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access messages"
  ON public.messages FOR ALL TO service_role USING (true) WITH CHECK (true);
