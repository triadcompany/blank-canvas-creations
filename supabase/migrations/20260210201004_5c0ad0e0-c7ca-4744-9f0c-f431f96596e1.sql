
CREATE TABLE public.whatsapp_routing_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text UNIQUE NOT NULL,
  last_assigned_user_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_routing_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read routing state"
  ON public.whatsapp_routing_state FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert routing state"
  ON public.whatsapp_routing_state FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update routing state"
  ON public.whatsapp_routing_state FOR UPDATE TO authenticated
  USING (true);
