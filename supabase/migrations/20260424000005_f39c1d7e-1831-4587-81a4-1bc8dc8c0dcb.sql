
-- Robust Clerk identity resolver. PostgREST exposes incoming HTTP headers via
-- `request.headers` as a JSON object — `request.header.<name>` does NOT work.
-- This new version parses request.headers and falls back to JWT sub.
CREATE OR REPLACE FUNCTION public.get_clerk_user_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
  v_headers text;
  v_jwt jsonb;
BEGIN
  -- 1) Custom header forwarded by the SPA (lowercased by PostgREST)
  BEGIN
    v_headers := current_setting('request.headers', true);
    IF v_headers IS NOT NULL AND v_headers <> '' THEN
      v_id := nullif((v_headers::jsonb) ->> 'x-clerk-user-id', '');
      IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 2) Legacy GUC (kept for backwards compatibility)
  BEGIN
    v_id := nullif(current_setting('request.header.x-clerk-user-id', true), '');
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 3) Supabase JWT (when sessions exist)
  BEGIN
    v_jwt := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    IF v_jwt IS NOT NULL THEN
      v_id := nullif(v_jwt ->> 'sub', '');
      IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_clerk_user_id() TO anon, authenticated, service_role;
