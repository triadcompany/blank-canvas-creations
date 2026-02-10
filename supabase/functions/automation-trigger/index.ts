import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { organization_id, lead_id, trigger_type } = await req.json();

    if (!organization_id || !lead_id || !trigger_type) {
      return new Response(
        JSON.stringify({ error: "Missing organization_id, lead_id or trigger_type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[automation-trigger] org=${organization_id} lead=${lead_id} trigger=${trigger_type}`);

    // Find active automations matching this trigger
    const { data: automations, error: fetchErr } = await supabase
      .from("automations")
      .select("id, flow_definition")
      .eq("organization_id", organization_id)
      .eq("is_active", true);

    if (fetchErr) throw fetchErr;

    const matching = (automations || []).filter((a: any) => {
      const nodes = a.flow_definition?.nodes || [];
      return nodes.some(
        (n: any) =>
          n.type === "trigger" && n.data?.config?.triggerType === trigger_type
      );
    });

    if (matching.length === 0) {
      console.log("[automation-trigger] No matching automations found");
      return new Response(
        JSON.stringify({ message: "No matching automations", runs: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const runIds: string[] = [];

    for (const automation of matching) {
      const flow = automation.flow_definition;
      const nodes: any[] = flow.nodes || [];
      const edges: any[] = flow.edges || [];

      // Build execution order via BFS from trigger
      const triggerNode = nodes.find(
        (n: any) =>
          n.type === "trigger" && n.data?.config?.triggerType === trigger_type
      );
      if (!triggerNode) continue;

      const executionOrder = buildExecutionOrder(triggerNode.id, nodes, edges);

      // Create the run
      const { data: run, error: runErr } = await supabase
        .from("automation_runs")
        .insert({
          automation_id: automation.id,
          organization_id,
          lead_id,
          status: "running",
          current_node_id: executionOrder[0]?.id || null,
        })
        .select("id")
        .single();

      if (runErr) {
        console.error("[automation-trigger] Error creating run:", runErr);
        continue;
      }

      // Create steps
      const steps = executionOrder.map((node: any, idx: number) => ({
        run_id: run.id,
        node_id: node.id,
        node_type: node.type,
        status: "pending",
        input_data: node.data?.config || {},
      }));

      if (steps.length > 0) {
        const { error: stepsErr } = await supabase
          .from("automation_run_steps")
          .insert(steps);
        if (stepsErr) console.error("[automation-trigger] Steps insert error:", stepsErr);
      }

      // Execute synchronously until a delay node
      await executeRun(supabase, run.id, lead_id, organization_id);

      runIds.push(run.id);
    }

    return new Response(
      JSON.stringify({ message: `Started ${runIds.length} automation(s)`, runs: runIds }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[automation-trigger] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildExecutionOrder(
  startId: string,
  nodes: any[],
  edges: any[]
): any[] {
  const order: any[] = [];
  const visited = new Set<string>();
  const queue = [startId];

  // Skip the trigger node itself, start from its children
  visited.add(startId);
  const firstChildren = edges
    .filter((e: any) => e.source === startId)
    .map((e: any) => e.target);

  for (const childId of firstChildren) {
    if (!visited.has(childId)) {
      queue.push(childId);
    }
  }
  // Remove startId from queue
  queue.shift();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodes.find((n: any) => n.id === nodeId);
    if (!node) continue;

    order.push(node);

    const children = edges
      .filter((e: any) => e.source === nodeId)
      .map((e: any) => e.target);
    for (const childId of children) {
      if (!visited.has(childId)) {
        queue.push(childId);
      }
    }
  }

  return order;
}

async function executeRun(
  supabase: any,
  runId: string,
  leadId: string,
  organizationId: string
) {
  // Get pending steps in order
  const { data: steps, error } = await supabase
    .from("automation_run_steps")
    .select("*")
    .eq("run_id", runId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error || !steps || steps.length === 0) {
    // Mark run complete
    await supabase
      .from("automation_runs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", runId);
    return;
  }

  for (const step of steps) {
    // Mark step running
    await supabase
      .from("automation_run_steps")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", step.id);

    try {
      if (step.node_type === "delay") {
        // Calculate next_run_at and pause
        const config = step.input_data || {};
        const amount = config.amount || 1;
        const unit = config.unit || "hours";
        const delayMs =
          unit === "minutes"
            ? amount * 60 * 1000
            : unit === "hours"
            ? amount * 3600 * 1000
            : amount * 86400 * 1000;

        const nextRunAt = new Date(Date.now() + delayMs).toISOString();

        await supabase
          .from("automation_run_steps")
          .update({ status: "completed", completed_at: new Date().toISOString(), output_data: { next_run_at: nextRunAt } })
          .eq("id", step.id);

        await supabase
          .from("automation_runs")
          .update({ status: "waiting", current_node_id: step.node_id, next_run_at: nextRunAt })
          .eq("id", runId);

        console.log(`[automation-trigger] Run ${runId} paused until ${nextRunAt}`);
        return; // Stop execution, scheduler will continue
      }

      if (step.node_type === "message") {
        const config = step.input_data || {};
        const messageText = config.text || "";

        // Get lead phone
        const { data: lead } = await supabase
          .from("leads")
          .select("phone, name")
          .eq("id", leadId)
          .single();

        if (lead?.phone && messageText) {
          // Resolve variables
          const resolvedText = messageText
            .replace(/\{\{lead\.name\}\}/g, lead.name || "")
            .replace(/\{\{lead\.phone\}\}/g, lead.phone || "");

          // Send via evolution-send edge function
          const sent = await sendWhatsAppMessage(organizationId, lead.phone, resolvedText, leadId, runId);

          await supabase
            .from("automation_run_steps")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
              output_data: { sent, resolved_text: resolvedText },
            })
            .eq("id", step.id);

          // Log
          await supabase.from("automation_logs").insert({
            automation_id: (await supabase.from("automation_runs").select("automation_id").eq("id", runId).single()).data?.automation_id,
            organization_id: organizationId,
            node_id: step.node_id,
            node_type: "message",
            status: sent ? "success" : "warning",
            message: sent ? `Mensagem enviada para ${lead.phone}` : `Mensagem preparada (sem provedor WhatsApp configurado)`,
            lead_id: leadId,
            metadata: { text: resolvedText },
          });
        } else {
          await supabase
            .from("automation_run_steps")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
              output_data: { skipped: true, reason: !lead?.phone ? "no_phone" : "no_text" },
            })
            .eq("id", step.id);
        }
        continue;
      }

      if (step.node_type === "action") {
        const config = step.input_data || {};
        // MVP stubs for actions
        await supabase
          .from("automation_run_steps")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            output_data: { action: config.actionType, stub: true },
          })
          .eq("id", step.id);

        await supabase.from("automation_logs").insert({
          automation_id: (await supabase.from("automation_runs").select("automation_id").eq("id", runId).single()).data?.automation_id,
          organization_id: organizationId,
          node_id: step.node_id,
          node_type: "action",
          status: "success",
          message: `Ação "${config.actionType}" executada (stub)`,
          lead_id: leadId,
        });
        continue;
      }

      if (step.node_type === "condition") {
        // MVP: skip conditions, just pass through
        await supabase
          .from("automation_run_steps")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            output_data: { condition: "passed", stub: true },
          })
          .eq("id", step.id);
        continue;
      }

      // Unknown node type - skip
      await supabase
        .from("automation_run_steps")
        .update({ status: "skipped", completed_at: new Date().toISOString() })
        .eq("id", step.id);
    } catch (stepErr) {
      console.error(`[automation-trigger] Step ${step.id} error:`, stepErr);
      await supabase
        .from("automation_run_steps")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: stepErr instanceof Error ? stepErr.message : "Unknown error",
        })
        .eq("id", step.id);

      await supabase
        .from("automation_runs")
        .update({ status: "failed", error_message: `Step ${step.node_id} failed` })
        .eq("id", runId);
      return;
    }
  }

  // All steps done
  await supabase
    .from("automation_runs")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", runId);
}

async function sendWhatsAppMessage(
  organizationId: string,
  phone: string,
  text: string,
  leadId?: string,
  runId?: string
): Promise<boolean> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const response = await fetch(`${supabaseUrl}/functions/v1/evolution-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        organization_id: organizationId,
        to_e164: phone,
        message: text,
        lead_id: leadId || null,
        automation_run_id: runId || null,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[automation-trigger] evolution-send error:", errBody);
      return false;
    }

    console.log(`[automation-trigger] Message sent via evolution-send to ${phone}`);
    return true;
  } catch (err) {
    console.error("[automation-trigger] send exception:", err);
    return false;
  }
}
