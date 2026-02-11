import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { action, ...params } = await req.json();

    switch (action) {
      // ─── LIST AUTOMATIONS ───
      case "list": {
        const { organization_id } = params;
        if (!organization_id) return respond({ ok: false, message: "organization_id required" }, 400);

        const { data, error } = await supabase
          .from("automations")
          .select("*")
          .eq("organization_id", organization_id)
          .order("created_at", { ascending: false });

        if (error) return respond({ ok: false, message: error.message }, 500);
        return respond({ ok: true, automations: data });
      }

      // ─── CREATE AUTOMATION + INITIAL FLOW ───
      case "create": {
        const { organization_id, name, description, created_by, channel } = params;
        if (!organization_id || !name || !created_by)
          return respond({ ok: false, message: "organization_id, name, created_by required" }, 400);

        const initialNodes = [
          {
            id: "trigger_initial",
            type: "trigger",
            position: { x: 250, y: 50 },
            data: { label: "Gatilho", config: { triggerType: "lead_created" } },
          },
        ];

        // Insert automation
        const { data: automation, error: autoErr } = await supabase
          .from("automations")
          .insert({
            organization_id,
            name,
            description: description || null,
            channel: channel || "whatsapp",
            created_by,
            is_active: false,
          })
          .select()
          .single();

        if (autoErr) return respond({ ok: false, message: autoErr.message }, 500);

        // Insert initial flow
        const { data: flow, error: flowErr } = await supabase
          .from("automation_flows")
          .insert({
            organization_id,
            automation_id: automation.id,
            nodes: initialNodes,
            edges: [],
            entry_node_id: "trigger_initial",
            version: 1,
          })
          .select()
          .single();

        if (flowErr) {
          console.error("Flow insert error:", flowErr);
          // Rollback automation
          await supabase.from("automations").delete().eq("id", automation.id);
          return respond({ ok: false, message: flowErr.message }, 500);
        }

        return respond({ ok: true, automation, flow });
      }

      // ─── UPDATE AUTOMATION METADATA ───
      case "update": {
        const { id, updates } = params;
        if (!id) return respond({ ok: false, message: "id required" }, 400);

        // Only allow safe fields
        const allowed = ["name", "description", "channel", "is_active", "trigger_type", "trigger_event_name", "allow_ai_triggers", "allow_human_triggers", "throttle_seconds"];
        const safeUpdates: Record<string, unknown> = {};
        for (const key of allowed) {
          if (updates[key] !== undefined) safeUpdates[key] = updates[key];
        }

        const { error } = await supabase
          .from("automations")
          .update(safeUpdates)
          .eq("id", id);

        if (error) return respond({ ok: false, message: error.message }, 500);
        return respond({ ok: true });
      }

      // ─── DELETE AUTOMATION ───
      case "delete": {
        const { id } = params;
        if (!id) return respond({ ok: false, message: "id required" }, 400);

        const { error } = await supabase.from("automations").delete().eq("id", id);
        if (error) return respond({ ok: false, message: error.message }, 500);
        return respond({ ok: true });
      }

      // ─── GET FLOW (latest version) ───
      case "get_flow": {
        const { automation_id } = params;
        if (!automation_id) return respond({ ok: false, message: "automation_id required" }, 400);

        const { data, error } = await supabase
          .from("automation_flows")
          .select("*")
          .eq("automation_id", automation_id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) return respond({ ok: false, message: error.message }, 500);
        return respond({ ok: true, flow: data });
      }

      // ─── SAVE FLOW (increment version) ───
      case "save_flow": {
        const { automation_id, organization_id, nodes, edges } = params;
        if (!automation_id || !organization_id)
          return respond({ ok: false, message: "automation_id, organization_id required" }, 400);

        // Validate: max 1 trigger
        const triggers = (nodes || []).filter((n: any) => n.type === "trigger");
        if (triggers.length > 1) {
          return respond({ ok: false, message: "Só pode haver 1 nó de gatilho por automação." }, 400);
        }

        // Get current max version
        const { data: current } = await supabase
          .from("automation_flows")
          .select("version")
          .eq("automation_id", automation_id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextVersion = (current?.version || 0) + 1;
        const entryNodeId = triggers.length > 0 ? triggers[0].id : null;

        // Insert new version
        const { data: flow, error } = await supabase
          .from("automation_flows")
          .insert({
            organization_id,
            automation_id,
            nodes: nodes || [],
            edges: edges || [],
            entry_node_id: entryNodeId,
            version: nextVersion,
          })
          .select()
          .single();

        if (error) return respond({ ok: false, message: error.message }, 500);

        // ── Sync trigger config from flow's trigger node to automations table ──
        if (triggers.length > 0) {
          const triggerConfig = triggers[0].data?.config || {};
          const triggerUpdates: Record<string, unknown> = {};

          if (triggerConfig.triggerType === "event") {
            triggerUpdates.trigger_type = "event";
            triggerUpdates.trigger_event_name = triggerConfig.triggerEventName || null;
            triggerUpdates.allow_ai_triggers = triggerConfig.allowAiTriggers ?? false;
            triggerUpdates.allow_human_triggers = triggerConfig.allowHumanTriggers ?? true;
            triggerUpdates.throttle_seconds = triggerConfig.throttleSeconds ?? 0;
          } else {
            triggerUpdates.trigger_type = triggerConfig.triggerType || "manual";
            triggerUpdates.trigger_event_name = null;
            triggerUpdates.allow_ai_triggers = false;
            triggerUpdates.allow_human_triggers = true;
            triggerUpdates.throttle_seconds = 0;
          }

          await supabase
            .from("automations")
            .update(triggerUpdates)
            .eq("id", automation_id);
        }

        return respond({ ok: true, flow });
      }

      // ─── DUPLICATE AUTOMATION ───
      case "duplicate": {
        const { id, organization_id, created_by } = params;
        if (!id || !organization_id || !created_by)
          return respond({ ok: false, message: "id, organization_id, created_by required" }, 400);

        // Get original
        const { data: original, error: origErr } = await supabase
          .from("automations")
          .select("*")
          .eq("id", id)
          .single();

        if (origErr || !original) return respond({ ok: false, message: "Automação não encontrada" }, 404);

        // Get latest flow
        const { data: origFlow } = await supabase
          .from("automation_flows")
          .select("*")
          .eq("automation_id", id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Create copy
        const { data: newAuto, error: newErr } = await supabase
          .from("automations")
          .insert({
            organization_id,
            name: `${original.name} (cópia)`,
            description: original.description,
            channel: original.channel,
            created_by,
            is_active: false,
          })
          .select()
          .single();

        if (newErr) return respond({ ok: false, message: newErr.message }, 500);

        // Copy flow
        if (origFlow) {
          await supabase.from("automation_flows").insert({
            organization_id,
            automation_id: newAuto.id,
            nodes: origFlow.nodes,
            edges: origFlow.edges,
            entry_node_id: origFlow.entry_node_id,
            version: 1,
          });
        }

        return respond({ ok: true, automation: newAuto });
      }

      // ─── LIST RUNS ───
      case "list_runs": {
        const { automation_id, organization_id } = params;
        if (!organization_id) return respond({ ok: false, message: "organization_id required" }, 400);

        let query = supabase
          .from("automation_runs")
          .select("*")
          .eq("organization_id", organization_id)
          .order("started_at", { ascending: false })
          .limit(50);

        if (automation_id) {
          query = query.eq("automation_id", automation_id);
        }

        const { data, error } = await query;
        if (error) return respond({ ok: false, message: error.message }, 500);
        return respond({ ok: true, runs: data || [] });
      }

      // ─── LIST LOGS ───
      case "list_logs": {
        const { run_id, automation_id, organization_id } = params;
        if (!organization_id) return respond({ ok: false, message: "organization_id required" }, 400);

        let query = supabase
          .from("automation_logs")
          .select("*")
          .eq("organization_id", organization_id)
          .order("created_at", { ascending: true })
          .limit(100);

        if (run_id) query = query.eq("run_id", run_id);
        if (automation_id) query = query.eq("automation_id", automation_id);

        const { data, error } = await query;
        if (error) return respond({ ok: false, message: error.message }, 500);
        return respond({ ok: true, logs: data || [] });
      }

      // ─── RUN STATS ───
      case "run_stats": {
        const { organization_id, automation_id } = params;
        if (!organization_id) return respond({ ok: false, message: "organization_id required" }, 400);

        let query = supabase
          .from("automation_runs")
          .select("status")
          .eq("organization_id", organization_id);

        if (automation_id) query = query.eq("automation_id", automation_id);

        const { data, error } = await query;
        if (error) return respond({ ok: false, message: error.message }, 500);

        const stats = { total: 0, running: 0, completed: 0, failed: 0, waiting: 0 };
        for (const r of data || []) {
          stats.total++;
          if (r.status === "running") stats.running++;
          else if (r.status === "completed") stats.completed++;
          else if (r.status === "failed") stats.failed++;
          else if (r.status === "waiting") stats.waiting++;
        }
        return respond({ ok: true, stats });
      }

      // ─── CREATE TEMPLATE: Follow-up 24h ───
      case "create_template": {
        const { organization_id, created_by, template_name } = params;
        if (!organization_id || !created_by)
          return respond({ ok: false, message: "organization_id, created_by required" }, 400);

        const tName = template_name || "Follow-up - resposta em 24h";

        // Build template nodes
        const nodes = [
          {
            id: "tpl_trigger",
            type: "trigger",
            position: { x: 250, y: 30 },
            data: { label: "Lead criado", config: { triggerType: "lead_created" } },
          },
          {
            id: "tpl_msg1",
            type: "message",
            position: { x: 250, y: 160 },
            data: { label: "Mensagem inicial", config: { text: "Olá {{lead.name}}, tudo bem? Posso te ajudar?" } },
          },
          {
            id: "tpl_wait",
            type: "wait_for_reply",
            position: { x: 250, y: 310 },
            data: { label: "Aguardar resposta", config: { timeout_amount: 24, timeout_unit: "hours" } },
          },
          {
            id: "tpl_action_stage",
            type: "action",
            position: { x: 80, y: 490 },
            data: { label: "Mover etapa", config: { actionType: "move_stage", params: { stage: "Em atendimento" } } },
          },
          {
            id: "tpl_msg_timeout",
            type: "message",
            position: { x: 420, y: 490 },
            data: { label: "Lembrete", config: { text: "Oi {{lead.name}}, passando para confirmar se ainda precisa de ajuda." } },
          },
        ];

        const edges = [
          { id: "e_trig_msg1", source: "tpl_trigger", target: "tpl_msg1", sourceHandle: "default" },
          { id: "e_msg1_wait", source: "tpl_msg1", target: "tpl_wait", sourceHandle: "default" },
          { id: "e_wait_replied", source: "tpl_wait", target: "tpl_action_stage", sourceHandle: "replied" },
          { id: "e_wait_timeout", source: "tpl_wait", target: "tpl_msg_timeout", sourceHandle: "timeout" },
        ];

        // Create automation
        const { data: automation, error: autoErr } = await supabase
          .from("automations")
          .insert({
            organization_id,
            name: tName,
            description: "Template: envia mensagem, aguarda 24h e move etapa ou envia lembrete.",
            channel: "whatsapp",
            created_by,
            is_active: false,
          })
          .select()
          .single();

        if (autoErr) return respond({ ok: false, message: autoErr.message }, 500);

        const { error: flowErr } = await supabase
          .from("automation_flows")
          .insert({
            organization_id,
            automation_id: automation.id,
            nodes,
            edges,
            entry_node_id: "tpl_trigger",
            version: 1,
          });

        if (flowErr) {
          await supabase.from("automations").delete().eq("id", automation.id);
          return respond({ ok: false, message: flowErr.message }, 500);
        }

        return respond({ ok: true, automation });
      }

      // ─── CREATE TEMPLATE: Keyword Lead (anuncio → criar lead) ───
      case "create_template_keyword_lead": {
        const { organization_id, created_by, pipeline_id, stage_id } = params;
        if (!organization_id || !created_by)
          return respond({ ok: false, message: "organization_id, created_by required" }, 400);

        const tplName = "Primeira mensagem contém 'anuncio' → criar lead (Meta Ads)";

        // Build template nodes
        const nodes = [
          {
            id: "kw_trigger",
            type: "trigger",
            position: { x: 250, y: 30 },
            data: {
              label: "Mensagem recebida (WhatsApp)",
              config: {
                triggerType: "inbound_message_keyword",
                keyword: "anuncio",
                firstMessageOnly: true,
              },
            },
          },
          {
            id: "kw_condition",
            type: "condition",
            position: { x: 250, y: 180 },
            data: {
              label: "Primeira mensagem do contato?",
              config: {
                conditionType: "first_touch",
                description: "Verifica se é a primeira mensagem deste telefone na organização",
              },
            },
          },
          {
            id: "kw_action_create_lead",
            type: "action",
            position: { x: 250, y: 360 },
            data: {
              label: "Criar Lead (Meta Ads)",
              config: {
                actionType: "create_lead",
                params: {
                  source: "Meta Ads",
                  source_detail: "WhatsApp keyword: anuncio",
                  pipeline_id: pipeline_id || null,
                  stage_id: stage_id || null,
                },
              },
            },
          },
        ];

        const edges = [
          { id: "e_kw_trig_cond", source: "kw_trigger", target: "kw_condition", sourceHandle: "default" },
          { id: "e_kw_cond_action", source: "kw_condition", target: "kw_action_create_lead", sourceHandle: "yes" },
        ];

        // Create automation
        const { data: kwAutomation, error: kwAutoErr } = await supabase
          .from("automations")
          .insert({
            organization_id,
            name: tplName,
            description: "Cria lead automático com origem Meta Ads quando a primeira mensagem contém 'anuncio'.",
            channel: "whatsapp",
            created_by,
            is_active: true,
            trigger_type: "inbound_message_keyword",
            trigger_event_name: "anuncio",
          })
          .select()
          .single();

        if (kwAutoErr) return respond({ ok: false, message: kwAutoErr.message }, 500);

        const { error: kwFlowErr } = await supabase
          .from("automation_flows")
          .insert({
            organization_id,
            automation_id: kwAutomation.id,
            nodes,
            edges,
            entry_node_id: "kw_trigger",
            version: 1,
          });

        if (kwFlowErr) {
          await supabase.from("automations").delete().eq("id", kwAutomation.id);
          return respond({ ok: false, message: kwFlowErr.message }, 500);
        }

        return respond({ ok: true, automation: kwAutomation });
      }

      default:
        return respond({ ok: false, message: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("[automations-api] Unhandled:", err);
    return respond({ ok: false, message: String(err) }, 500);
  }
});
