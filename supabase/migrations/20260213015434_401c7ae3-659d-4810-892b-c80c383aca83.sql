
-- Fix Security Definer views (recreate with security_invoker=on)
DROP VIEW IF EXISTS public.crm_funnel;
CREATE VIEW public.crm_funnel WITH (security_invoker=on) AS
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
CREATE VIEW public.dashboard_stats WITH (security_invoker=on) AS
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
CREATE VIEW public.financial_dashboard WITH (security_invoker=on) AS
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
CREATE VIEW public.financial_summary WITH (security_invoker=on) AS
SELECT o.id AS organization_id,
    o.name AS organization_name,
    (SELECT COALESCE(sum(pag.valor), 0) FROM pagamentos pag WHERE pag.organization_id = o.id AND pag.status = 'confirmado') AS total_receitas,
    (SELECT COALESCE(sum(desp.valor), 0) FROM despesas desp WHERE desp.organization_id = o.id) AS total_despesas,
    (SELECT COALESCE(sum(pag.valor), 0) FROM pagamentos pag WHERE pag.organization_id = o.id AND pag.status = 'confirmado') - (SELECT COALESCE(sum(desp.valor), 0) FROM despesas desp WHERE desp.organization_id = o.id) AS lucro,
    (SELECT count(*) FROM pagamentos pag WHERE pag.organization_id = o.id AND pag.status = 'confirmado') AS total_pagamentos,
    (SELECT COALESCE(sum(pag.valor), 0) / NULLIF(count(DISTINCT pag.paciente_id), 0)::numeric FROM pagamentos pag WHERE pag.organization_id = o.id AND pag.status = 'confirmado') AS ticket_medio
FROM public.organizations o;

-- Also fix profiles_with_roles view
DROP VIEW IF EXISTS public.profiles_with_roles;
CREATE VIEW public.profiles_with_roles WITH (security_invoker=on) AS
SELECT p.id, p.user_id, p.name, p.email, p.avatar_url, p.organization_id, p.whatsapp_e164, p.created_at, p.updated_at, ur.role
FROM profiles p LEFT JOIN user_roles ur ON p.user_id = ur.user_id;
