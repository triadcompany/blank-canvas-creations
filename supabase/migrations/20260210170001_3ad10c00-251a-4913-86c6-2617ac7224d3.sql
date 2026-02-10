
-- Enable pg_net if not already
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule cron for automation scheduler every minute
SELECT cron.schedule(
  'automation-scheduler-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tapbwlmdvluqdgvixkxf.supabase.co/functions/v1/automation-scheduler',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhcGJ3bG1kdmx1cWRndml4a3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2MDY0NDgsImV4cCI6MjA3MDE4MjQ0OH0.U2p9jneQ6Lcgu672Z8W-KnKhLgMLygDk1jB4a0YIwvQ"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
