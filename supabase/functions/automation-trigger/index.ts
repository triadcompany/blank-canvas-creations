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

    const { organization_id, trigger_type, entity_type, entity_id, context } = await req.json();

    if (!organization_id || !trigger_type || !entity_id) {
      return respond({ ok: false, message: "organization_id, trigger_type, entity_id required" }, 400);
    }

    console.log(`[automation-trigger] org=${organization_id} trigger=${trigger_type} entity=${entity_id}`);

    // 1) Find active automations for this org
    const { data: automations, error: autoErr } = await supabase
      .from("automations")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("is_active", true);

    if (autoErr) {
      console.error("[automation-trigger] Error fetching automations:", autoErr);
      return respond({ ok: false, message: autoErr.message }, 500);
    }

    if (!automations || automations.length === 0) {
      return respond({ ok: true, message: "No active automations", runs_created: 0 });
    }

    // 2) For each automation, get latest flow and check if trigger matches
    const runsCreated: string[] = [];

    for (const automation of automations) {
      // Get latest flow version
      const { data: flow, error: flowErr } = await supabase
        .from("automation_flows")
        .select("id, nodes, edges, entry_node_id")
        .eq("automation_id", automation.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (flowErr || !flow) {
        console.log(`[automation-trigger] No flow for automation ${automation.id}`);
        continue;
      }

      const nodes: any[] = flow.nodes || [];
      const edges: any[] = flow.edges || [];

      // Find trigger node matching the trigger_type
      const triggerNode = nodes.find(
        (n: any) => n.type === "trigger" && n.data?.config?.triggerType === trigger_type
      );

      if (!triggerNode) continue;

      // 3) Find the first node after the trigger
      const outEdges = edges.filter((e: any) => e.source === triggerNode.id);
      if (outEdges.length === 0) {
        console.log(`[automation-trigger] Trigger has no outgoing edges in automation ${automation.id}`);
        // Log warning
        await supabase.from("automation_logs").insert({
          organization_id,
          automation_id: automation.id,
          node_id: triggerNode.id,
          level: "warn",
          message: "Gatilho ativado mas não tem nó seguinte conectado",
          data: { trigger_type, entity_id },
        });
        continue;
      }

      const firstNextNodeId = outEdges[0].target;
      const firstNextNode = nodes.find((n: any) => n.id === firstNextNodeId);

      if (!firstNextNode) {
        console.log(`[automation-trigger] Next node ${firstNextNodeId} not found`);
        continue;
      }

      // 4) Create automation_run
      const { data: run, error: runErr } = await supabase
        .from("automation_runs")
        .insert({
          organization_id,
          automation_id: automation.id,
          entity_type: entity_type || "lead",
          entity_id: String(entity_id),
          status: "running",
          current_node_id: firstNextNode.id,
          context: context || {},
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (runErr) {
        console.error(`[automation-trigger] Error creating run for ${automation.id}:`, runErr);
        continue;
      }

      // 5) Create the first automation_job
      const { error: jobErr } = await supabase
        .from("automation_jobs")
        .insert({
          organization_id,
          run_id: run.id,
          automation_id: automation.id,
          node_id: firstNextNode.id,
          job_type: firstNextNode.type || "message",
          payload: {
            node_config: firstNextNode.data?.config || {},
            node_label: firstNextNode.data?.label || "",
          },
          scheduled_for: new Date().toISOString(),
          status: "pending",
          attempts: 0,
        });

      if (jobErr) {
        console.error(`[automation-trigger] Error creating job:`, jobErr);
        // Mark run as failed
        await supabase
          .from("automation_runs")
          .update({ status: "failed", last_error: jobErr.message })
          .eq("id", run.id);
        continue;
      }

      // 6) Log the trigger event
      await supabase.from("automation_logs").insert({
        organization_id,
        run_id: run.id,
        automation_id: automation.id,
        node_id: triggerNode.id,
        level: "info",
        message: `Gatilho "${trigger_type}" disparado para ${entity_type || "lead"} ${entity_id}`,
        data: { trigger_type, entity_id, context, first_job_node: firstNextNode.id },
      });

      runsCreated.push(run.id);
      console.log(`[automation-trigger] Run ${run.id} created for automation ${automation.id}`);
    }

    return respond({
      ok: true,
      message: `${runsCreated.length} run(s) created`,
      runs_created: runsCreated.length,
      run_ids: runsCreated,
    });
  } catch (err) {
    console.error("[automation-trigger] Unhandled:", err);
    return respond({ ok: false, message: String(err) }, 500);
  }
});
