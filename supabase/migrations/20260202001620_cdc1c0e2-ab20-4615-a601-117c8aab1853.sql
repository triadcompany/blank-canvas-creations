-- Enable required extensions for cron jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule the process-followups function to run every 5 minutes
SELECT cron.schedule(
  'process-followups-every-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tapbwlmdvluqdgvixkxf.supabase.co/functions/v1/process-followups',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('triggered_at', now())
  ) AS request_id;
  $$
);