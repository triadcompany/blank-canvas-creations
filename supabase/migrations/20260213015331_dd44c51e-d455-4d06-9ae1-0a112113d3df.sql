
-- ============================================================
-- FASE C: DEPRECAÇÃO SEGURA DE TABELAS LEGADAS
-- ============================================================

-- 1. Criar schema _deprecated
CREATE SCHEMA IF NOT EXISTS _deprecated;

-- 2. Copiar saas_organizations faltantes para organizations
INSERT INTO public.organizations (id, name, cnpj, email, phone, address, is_active, created_at, updated_at)
SELECT s.id, s.name, s.cnpj, s.email, s.phone, s.address, s.is_active, s.created_at, s.updated_at
FROM public.saas_organizations s
WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = s.id)
ON CONFLICT (id) DO NOTHING;

-- 3. Drop FK constraints referencing public.users
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_criado_por_fkey;
ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_updated_by_fkey;
ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_assigned_to_fkey;
ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_created_by_fkey;
ALTER TABLE public.crm_lead_activities DROP CONSTRAINT IF EXISTS crm_lead_activities_user_id_fkey;
ALTER TABLE public.crm_lead_notes DROP CONSTRAINT IF EXISTS crm_lead_notes_user_id_fkey;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
ALTER TABLE public.professionals DROP CONSTRAINT IF EXISTS professionals_user_id_fkey;
ALTER TABLE public.external_integrations DROP CONSTRAINT IF EXISTS external_integrations_created_by_fkey;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_organization_id_fkey;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_invited_by_fkey;

-- 4. Drop FK constraints referencing public.saas_organizations
ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_organization_id_fkey;
ALTER TABLE public.crm_stages DROP CONSTRAINT IF EXISTS crm_stages_organization_id_fkey;
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_organization_id_fkey;
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS patients_organization_id_fkey;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_organization_id_fkey;
ALTER TABLE public.collaborators DROP CONSTRAINT IF EXISTS collaborators_organization_id_fkey;
ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_organization_id_fkey;
ALTER TABLE public.professionals DROP CONSTRAINT IF EXISTS professionals_organization_id_fkey;
ALTER TABLE public.pagamentos DROP CONSTRAINT IF EXISTS pagamentos_organization_id_fkey;
ALTER TABLE public.despesas DROP CONSTRAINT IF EXISTS despesas_organization_id_fkey;
ALTER TABLE public.entradas DROP CONSTRAINT IF EXISTS entradas_organization_id_fkey;
ALTER TABLE public.investimentos_marketing DROP CONSTRAINT IF EXISTS investimentos_marketing_organization_id_fkey;
ALTER TABLE public.servicos DROP CONSTRAINT IF EXISTS servicos_organization_id_fkey;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_organization_id_fkey;
ALTER TABLE public.calendar_events DROP CONSTRAINT IF EXISTS calendar_events_organization_id_fkey;
ALTER TABLE public.ai_interactions DROP CONSTRAINT IF EXISTS ai_interactions_organization_id_fkey;
ALTER TABLE public.n8n_credentials DROP CONSTRAINT IF EXISTS n8n_credentials_organization_id_fkey;
ALTER TABLE public.webhook_configurations DROP CONSTRAINT IF EXISTS webhook_configurations_organization_id_fkey;
ALTER TABLE public.webhook_events DROP CONSTRAINT IF EXISTS webhook_events_organization_id_fkey;
ALTER TABLE public.webhook_logs DROP CONSTRAINT IF EXISTS webhook_logs_organization_id_fkey;
ALTER TABLE public.instagram_connections DROP CONSTRAINT IF EXISTS instagram_connections_organization_id_fkey;
ALTER TABLE public.instagram_conversations DROP CONSTRAINT IF EXISTS instagram_conversations_organization_id_fkey;
ALTER TABLE public.instagram_quick_replies DROP CONSTRAINT IF EXISTS instagram_quick_replies_organization_id_fkey;
ALTER TABLE public.instagram_conversation_tags DROP CONSTRAINT IF EXISTS instagram_conversation_tags_organization_id_fkey;
ALTER TABLE public.instagram_metrics DROP CONSTRAINT IF EXISTS instagram_metrics_organization_id_fkey;
ALTER TABLE public.instagram_distribution_config DROP CONSTRAINT IF EXISTS instagram_distribution_config_organization_id_fkey;
ALTER TABLE public.instagram_distribution_state DROP CONSTRAINT IF EXISTS instagram_distribution_state_organization_id_fkey;
ALTER TABLE public.whatsapp_threads DROP CONSTRAINT IF EXISTS whatsapp_threads_organization_id_fkey;
ALTER TABLE public.social_integrations DROP CONSTRAINT IF EXISTS social_integrations_organization_id_fkey;
ALTER TABLE public.automation_keyword_rules DROP CONSTRAINT IF EXISTS automation_keyword_rules_organization_id_fkey;
ALTER TABLE public.meta_capi_events DROP CONSTRAINT IF EXISTS meta_capi_events_organization_id_fkey;
ALTER TABLE public.meta_event_mappings DROP CONSTRAINT IF EXISTS meta_event_mappings_organization_id_fkey;
ALTER TABLE public.meta_capi_settings DROP CONSTRAINT IF EXISTS meta_capi_settings_organization_id_fkey;
ALTER TABLE public.meta_capi_mappings DROP CONSTRAINT IF EXISTS meta_capi_mappings_organization_id_fkey;
ALTER TABLE public.meta_capi_logs DROP CONSTRAINT IF EXISTS meta_capi_logs_organization_id_fkey;
ALTER TABLE public.meta_capi_dedup DROP CONSTRAINT IF EXISTS meta_capi_dedup_organization_id_fkey;
ALTER TABLE public.capi_event_definitions DROP CONSTRAINT IF EXISTS capi_event_definitions_organization_id_fkey;

-- 5. Re-create FK constraints pointing to organizations instead of saas_organizations
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.crm_stages ADD CONSTRAINT crm_stages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.appointments ADD CONSTRAINT appointments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.patients ADD CONSTRAINT patients_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.clients ADD CONSTRAINT clients_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.collaborators ADD CONSTRAINT collaborators_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.consultations ADD CONSTRAINT consultations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.professionals ADD CONSTRAINT professionals_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.pagamentos ADD CONSTRAINT pagamentos_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.despesas ADD CONSTRAINT despesas_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.entradas ADD CONSTRAINT entradas_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.investimentos_marketing ADD CONSTRAINT investimentos_marketing_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.servicos ADD CONSTRAINT servicos_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.calendar_events ADD CONSTRAINT calendar_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.ai_interactions ADD CONSTRAINT ai_interactions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.n8n_credentials ADD CONSTRAINT n8n_credentials_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.webhook_configurations ADD CONSTRAINT webhook_configurations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.webhook_events ADD CONSTRAINT webhook_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.webhook_logs ADD CONSTRAINT webhook_logs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.instagram_connections ADD CONSTRAINT instagram_connections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.instagram_conversations ADD CONSTRAINT instagram_conversations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.instagram_quick_replies ADD CONSTRAINT instagram_quick_replies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.instagram_conversation_tags ADD CONSTRAINT instagram_conversation_tags_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.instagram_metrics ADD CONSTRAINT instagram_metrics_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.instagram_distribution_config ADD CONSTRAINT instagram_distribution_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.instagram_distribution_state ADD CONSTRAINT instagram_distribution_state_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.whatsapp_threads ADD CONSTRAINT whatsapp_threads_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.social_integrations ADD CONSTRAINT social_integrations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.automation_keyword_rules ADD CONSTRAINT automation_keyword_rules_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.meta_capi_events ADD CONSTRAINT meta_capi_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.meta_event_mappings ADD CONSTRAINT meta_event_mappings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.meta_capi_settings ADD CONSTRAINT meta_capi_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.meta_capi_mappings ADD CONSTRAINT meta_capi_mappings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.meta_capi_logs ADD CONSTRAINT meta_capi_logs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.meta_capi_dedup ADD CONSTRAINT meta_capi_dedup_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.capi_event_definitions ADD CONSTRAINT capi_event_definitions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);

-- 6. Drop and recreate views that referenced saas_organizations
DROP VIEW IF EXISTS public.crm_funnel;
CREATE VIEW public.crm_funnel AS
SELECT o.id AS organization_id,
    o.name AS organization_name,
    count(CASE WHEN cl.stage = 'novo' THEN 1 END) AS leads_novos,
    count(CASE WHEN cl.stage = 'contato' THEN 1 END) AS leads_contato,
    count(CASE WHEN cl.stage = 'proposta' THEN 1 END) AS leads_proposta,
    count(CASE WHEN cl.stage = 'negociacao' THEN 1 END) AS leads_negociacao,
    count(CASE WHEN cl.stage = 'fechado' THEN 1 END) AS leads_fechados,
    count(CASE WHEN cl.stage = 'perdido' THEN 1 END) AS leads_perdidos,
    count(cl.id) AS total_leads,
    (count(CASE WHEN cl.stage = 'fechado' THEN 1 END)::numeric / NULLIF(count(cl.id), 0)::numeric) * 100 AS conversion_rate
FROM public.organizations o
LEFT JOIN public.crm_leads cl ON cl.organization_id = o.id
GROUP BY o.id, o.name;

DROP VIEW IF EXISTS public.dashboard_stats;
CREATE VIEW public.dashboard_stats AS
SELECT o.id AS organization_id,
    o.name AS organization_name,
    (SELECT count(*) FROM patients p WHERE p.organization_id = o.id) AS total_patients,
    (SELECT count(*) FROM professionals prof WHERE prof.organization_id = o.id AND prof.active = true) AS active_professionals,
    (SELECT count(*) FROM appointments a WHERE a.organization_id = o.id AND a.datetime::date = now()::date) AS appointments_today,
    (SELECT count(*) FROM appointments a WHERE a.organization_id = o.id AND a.datetime >= date_trunc('month', now())) AS appointments_this_month,
    (SELECT count(*) FROM crm_leads cl WHERE cl.organization_id = o.id) AS total_leads,
    (SELECT count(*) FROM crm_leads cl WHERE cl.organization_id = o.id AND cl.stage = 'fechado') AS converted_leads,
    (SELECT COALESCE(sum(p.valor), 0) FROM pagamentos p WHERE p.organization_id = o.id AND p.status = 'confirmado' AND p.data_pagamento >= date_trunc('month', now())) AS revenue_this_month
FROM public.organizations o;

DROP VIEW IF EXISTS public.financial_dashboard;
CREATE VIEW public.financial_dashboard AS
SELECT o.id AS organization_id,
    COALESCE(sum(CASE WHEN e.valor IS NOT NULL THEN e.valor ELSE 0 END), 0) AS total_entradas,
    count(e.id) AS total_transacoes_entrada,
    COALESCE(sum(CASE WHEN s.valor IS NOT NULL THEN s.valor ELSE 0 END), 0) AS total_saidas,
    count(s.id) AS total_transacoes_saida,
    COALESCE(sum(CASE WHEN e.valor IS NOT NULL THEN e.valor ELSE 0 END), 0) - COALESCE(sum(CASE WHEN s.valor IS NOT NULL THEN s.valor ELSE 0 END), 0) AS lucro_liquido,
    CASE WHEN count(e.id) > 0 THEN COALESCE(sum(CASE WHEN e.valor IS NOT NULL THEN e.valor ELSE 0 END), 0) / count(e.id)::numeric ELSE 0 END AS ticket_medio
FROM public.organizations o
LEFT JOIN public.entradas e ON e.organization_id = o.id
LEFT JOIN public.saidas s ON s.organization_id = o.id
GROUP BY o.id;

DROP VIEW IF EXISTS public.financial_summary;
CREATE VIEW public.financial_summary AS
SELECT o.id AS organization_id,
    o.name AS organization_name,
    (SELECT COALESCE(sum(pag.valor), 0) FROM pagamentos pag WHERE pag.organization_id = o.id AND pag.status = 'confirmado') AS total_receitas,
    (SELECT COALESCE(sum(desp.valor), 0) FROM despesas desp WHERE desp.organization_id = o.id) AS total_despesas,
    (SELECT COALESCE(sum(pag.valor), 0) FROM pagamentos pag WHERE pag.organization_id = o.id AND pag.status = 'confirmado') - (SELECT COALESCE(sum(desp.valor), 0) FROM despesas desp WHERE desp.organization_id = o.id) AS lucro,
    (SELECT count(*) FROM pagamentos pag WHERE pag.organization_id = o.id AND pag.status = 'confirmado') AS total_pagamentos,
    (SELECT COALESCE(sum(pag.valor), 0) / NULLIF(count(DISTINCT pag.paciente_id), 0)::numeric FROM pagamentos pag WHERE pag.organization_id = o.id AND pag.status = 'confirmado') AS ticket_medio
FROM public.organizations o;

-- 7. Drop legacy trigger on auth.users (handle_new_user)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 8. Drop legacy trigger on saas_organizations (create_user_on_organization)
DROP TRIGGER IF EXISTS create_user_on_org_trigger ON public.saas_organizations;

-- 9. Drop legacy functions
DROP FUNCTION IF EXISTS public.create_user_on_organization() CASCADE;

-- 10. Move legacy tables to _deprecated schema
ALTER TABLE public.users SET SCHEMA _deprecated;
ALTER TABLE public.saas_organizations SET SCHEMA _deprecated;

-- 11. Drop legacy view profiles_with_roles (depends on user_roles which we keep for now)
-- Keep it for now since it's referenced in types, just noting it's legacy
