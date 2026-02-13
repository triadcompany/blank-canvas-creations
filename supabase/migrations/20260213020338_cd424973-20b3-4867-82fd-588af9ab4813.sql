
-- ============================================================
-- PASSO 1: Fix search_path em TODAS as funções custom
-- Seguro: não muda comportamento, apenas fixa o search_path
-- ============================================================

-- Notification functions
ALTER FUNCTION public.create_notification_safe(uuid, uuid, text, text, jsonb) SET search_path = public;
ALTER FUNCTION public.create_system_notification(uuid, text, text, text) SET search_path = public;
ALTER FUNCTION public.create_manual_notification(uuid, uuid[], text, text, text, jsonb) SET search_path = public;
ALTER FUNCTION public.cleanup_old_notifications() SET search_path = public;
ALTER FUNCTION public.create_appointment_reminders() SET search_path = public;
ALTER FUNCTION public.notify_users_by_role(uuid, text[], text, text, text, jsonb) SET search_path = public;
ALTER FUNCTION public.notify_organization_users(uuid, text, text, text, jsonb) SET search_path = public;

-- Lead/CRM triggers
ALTER FUNCTION public.log_crm_lead_changes() SET search_path = public;
ALTER FUNCTION public.notify_lead_changes() SET search_path = public;
ALTER FUNCTION public.notify_lead_stage_change() SET search_path = public;
ALTER FUNCTION public.notify_new_lead() SET search_path = public;
ALTER FUNCTION public.create_crm_stage(text, text, integer, uuid) SET search_path = public;

-- Appointment triggers
ALTER FUNCTION public.auto_create_consultation() SET search_path = public;
ALTER FUNCTION public.notify_appointment_changes() SET search_path = public;
ALTER FUNCTION public.notify_appointment_status_change() SET search_path = public;
ALTER FUNCTION public.notify_new_appointment() SET search_path = public;
ALTER FUNCTION public.sync_appointment_consultation() SET search_path = public;
ALTER FUNCTION public.update_appointments_updated_at() SET search_path = public;

-- Consultation triggers
ALTER FUNCTION public.notify_consultation_changes() SET search_path = public;
ALTER FUNCTION public.notify_consultation_completed() SET search_path = public;

-- Patient/Client triggers
ALTER FUNCTION public.notify_client_changes() SET search_path = public;
ALTER FUNCTION public.notify_collaborator_changes() SET search_path = public;
ALTER FUNCTION public.notify_new_patient() SET search_path = public;
ALTER FUNCTION public.notify_new_professional() SET search_path = public;
ALTER FUNCTION public.buscar_clientes(text) SET search_path = public;
ALTER FUNCTION public.buscar_pacientes(text) SET search_path = public;

-- Financial triggers
ALTER FUNCTION public.notify_expense_changes() SET search_path = public;
ALTER FUNCTION public.notify_important_expense() SET search_path = public;
ALTER FUNCTION public.notify_marketing_investment() SET search_path = public;
ALTER FUNCTION public.notify_payment_changes() SET search_path = public;
ALTER FUNCTION public.notify_new_payment() SET search_path = public;

-- Automation functions
ALTER FUNCTION public.notify_automation_event(text, uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.get_automation_stats(uuid) SET search_path = public;
ALTER FUNCTION public.reprocess_failed_automation_events(uuid) SET search_path = public;
ALTER FUNCTION public.test_automation_trigger(text, uuid, jsonb) SET search_path = public;

-- Automation trigger functions
ALTER FUNCTION public.trigger_appointment_created() SET search_path = public;
ALTER FUNCTION public.trigger_appointment_status_changed() SET search_path = public;
ALTER FUNCTION public.trigger_automation_on_client_created() SET search_path = public;
ALTER FUNCTION public.trigger_client_created() SET search_path = public;
ALTER FUNCTION public.trigger_client_updated() SET search_path = public;
ALTER FUNCTION public.trigger_consultation_completed() SET search_path = public;
ALTER FUNCTION public.trigger_lead_created() SET search_path = public;
ALTER FUNCTION public.trigger_lead_stage_changed() SET search_path = public;
ALTER FUNCTION public.trigger_notification_created() SET search_path = public;
ALTER FUNCTION public.trigger_payment_received() SET search_path = public;

-- Webhook functions
ALTER FUNCTION public.trigger_webhook_event(uuid, text, jsonb) SET search_path = public;
ALTER FUNCTION public.test_webhook_configuration(uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.webhook_trigger_appointment_created() SET search_path = public;
ALTER FUNCTION public.webhook_trigger_appointment_status_changed() SET search_path = public;
ALTER FUNCTION public.webhook_trigger_client_created() SET search_path = public;
ALTER FUNCTION public.webhook_trigger_lead_created() SET search_path = public;
ALTER FUNCTION public.webhook_trigger_lead_updated() SET search_path = public;
ALTER FUNCTION public.webhook_trigger_payment_received() SET search_path = public;

-- N8N/Integration functions
ALTER FUNCTION public.decrypt_n8n_api_key(text) SET search_path = public;
ALTER FUNCTION public.encrypt_n8n_api_key(text) SET search_path = public;
ALTER FUNCTION public.test_n8n_connection(uuid, text, text) SET search_path = public;
ALTER FUNCTION public.update_n8n_credentials_updated_at() SET search_path = public;

-- Misc functions
ALTER FUNCTION public.set_organization_context(uuid) SET search_path = public;
ALTER FUNCTION public.set_worker_heartbeats_updated_at() SET search_path = public;
ALTER FUNCTION public.update_conversation_on_message() SET search_path = public;
ALTER FUNCTION public.update_professional_stats_on_appointment() SET search_path = public;

-- ============================================================
-- PASSO 2: Criar helper function para RLS com Clerk JWT
-- auth.jwt() ->> 'sub' retorna o clerk_user_id
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id 
  FROM public.profiles 
  WHERE clerk_user_id = (auth.jwt() ->> 'sub') 
  LIMIT 1;
$$;

-- Helper: check if current user is admin in their org
CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members 
    WHERE clerk_user_id = (auth.jwt() ->> 'sub') 
    AND role = 'admin'
  );
$$;
