
-- Update the trigger function with the new default sources
CREATE OR REPLACE FUNCTION public.insert_default_lead_sources()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.lead_sources (organization_id, name, sort_order)
  VALUES
    (NEW.id, 'Meta Ads', 10),
    (NEW.id, 'Indicação', 20),
    (NEW.id, 'Site', 30),
    (NEW.id, 'Instagram Orgânico', 40),
    (NEW.id, 'WhatsApp', 50)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- Seed the new sources for ALL existing organizations that don't have them yet
INSERT INTO public.lead_sources (organization_id, name, sort_order)
SELECT o.id, s.name, s.sort_order
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('Meta Ads', 10),
    ('Indicação', 20),
    ('Site', 30),
    ('Instagram Orgânico', 40),
    ('WhatsApp', 50)
) AS s(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_sources ls
  WHERE ls.organization_id = o.id AND lower(ls.name) = lower(s.name)
)
ON CONFLICT DO NOTHING;
