
-- ============================================================
-- FASE 1: Evolve lead_sources table + add lead_source_id FK to leads
-- ============================================================

-- 1a) Add sort_order column to lead_sources (if not exists)
ALTER TABLE public.lead_sources ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.lead_sources ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 1b) Make created_by nullable (some system-generated sources have no creator)
ALTER TABLE public.lead_sources ALTER COLUMN created_by DROP NOT NULL;

-- 1c) Add unique constraint (case-insensitive name per org, only active)
DROP INDEX IF EXISTS lead_sources_org_name_unique;
CREATE UNIQUE INDEX lead_sources_org_name_unique ON public.lead_sources (organization_id, lower(name)) WHERE is_active = true;

-- 1d) Add lead_source_id FK column to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lead_source_id uuid REFERENCES public.lead_sources(id);

-- 1e) Create index on leads.lead_source_id
CREATE INDEX IF NOT EXISTS idx_leads_lead_source_id ON public.leads (lead_source_id);

-- ============================================================
-- FASE 2: Backfill existing orgs with default lead sources
-- ============================================================
INSERT INTO public.lead_sources (organization_id, name, sort_order, is_active, created_by)
SELECT o.id, s.name, s.sort_order, true, (
  SELECT p.id FROM public.profiles p WHERE p.organization_id = o.id ORDER BY p.created_at ASC LIMIT 1
)
FROM public.organizations o
CROSS JOIN (VALUES
  ('Meta Ads', 10),
  ('Indicação', 20),
  ('Site', 30),
  ('Orgânico', 40)
) AS s(name, sort_order)
WHERE o.is_active = true
AND NOT EXISTS (
  SELECT 1 FROM public.lead_sources ls
  WHERE ls.organization_id = o.id AND lower(ls.name) = lower(s.name) AND ls.is_active = true
);

-- Update sort_order for existing sources that have sort_order = 0
UPDATE public.lead_sources SET sort_order = 10 WHERE lower(name) = 'meta ads' AND sort_order = 0;
UPDATE public.lead_sources SET sort_order = 20 WHERE lower(name) = 'indicação' AND sort_order = 0;
UPDATE public.lead_sources SET sort_order = 30 WHERE lower(name) = 'site' AND sort_order = 0;
UPDATE public.lead_sources SET sort_order = 40 WHERE lower(name) = 'orgânico' AND sort_order = 0;
