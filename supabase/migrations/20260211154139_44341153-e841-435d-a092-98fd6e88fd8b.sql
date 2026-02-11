-- Worker heartbeats for automation processing observability
CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  worker_name text PRIMARY KEY,
  last_run_at timestamptz NOT NULL DEFAULT now(),
  processed_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;

-- No client-side access by default (service-role only). If you want UI direct access later,
-- add explicit policies.

CREATE OR REPLACE FUNCTION public.set_worker_heartbeats_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_worker_heartbeats_updated_at ON public.worker_heartbeats;
CREATE TRIGGER trg_worker_heartbeats_updated_at
BEFORE UPDATE ON public.worker_heartbeats
FOR EACH ROW
EXECUTE FUNCTION public.set_worker_heartbeats_updated_at();

CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_last_run_at ON public.worker_heartbeats (last_run_at DESC);
