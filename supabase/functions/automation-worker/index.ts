import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_ATTEMPTS = 3;

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    console.log("[automation-worker] Polling for pending jobs...");

    // 1) Fetch pending jobs that are due
    const { data: jobs, error: fetchErr } = await supabase
      .from("automation_jobs")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .lt("attempts", MAX_ATTEMPTS)
      .order("scheduled_for", { ascending: true })
      .limit(50);

    if (fetchErr) throw fetchErr;

    if (!jobs || jobs.length === 0) {
      return respond({ ok: true, message: "No pending jobs", processed: 0 });
    }

    console.log(`[automation-worker] Found ${jobs.length} jobs to process`);

    let processed = 0;
    let failed = 0;

    for (const job of jobs) {
      try {
        // Increment attempts and mark as running
        await supabase
          .from("automation_jobs")
          .update({ status: "running", attempts: job.attempts + 1 })
          .eq("id", job.id);

        // Load the flow to find edges from this node
        const { data: flow } = await supabase
          .from("automation_flows")
          .select("nodes, edges")
          .eq("automation_id", job.automation_id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!flow) {
          await failJob(supabase, job, "Flow not found for automation");
          failed++;
          continue;
        }

        const nodes: any[] = flow.nodes || [];
        const edges: any[] = flow.edges || [];
        const currentNode = nodes.find((n: any) => n.id === job.node_id);

        if (!currentNode) {
          await failJob(supabase, job, `Node ${job.node_id} not found in flow`);
          failed++;
          continue;
        }

        // Process based on job type
        let result: JobResult;

        switch (job.job_type) {
          case "delay":
            result = processDelay(currentNode, job);
            break;
          case "condition":
            result = await processCondition(supabase, currentNode, job, edges);
            break;
          case "action":
            result = processAction(currentNode, job);
            break;
          case "message":
            result = await processMessage(supabase, currentNode, job);
            break;
          default:
            result = { status: "done", output: { skipped: true, reason: `Unknown type: ${job.job_type}` } };
        }

        // Mark current job as done
        await supabase
          .from("automation_jobs")
          .update({
            status: "done",
            last_error: null,
          })
          .eq("id", job.id);

        // Log execution
        await supabase.from("automation_logs").insert({
          organization_id: job.organization_id,
          automation_id: job.automation_id,
          run_id: job.run_id,
          node_id: job.node_id,
          level: "info",
          message: `Nó "${currentNode.data?.label || job.job_type}" executado com sucesso`,
          data: { job_type: job.job_type, output: result.output },
        });

        // Update run current_node_id
        await supabase
          .from("automation_runs")
          .update({ current_node_id: job.node_id })
          .eq("id", job.run_id);

        // Determine next node(s) and schedule
        const nextNodeId = result.nextNodeId;

        if (nextNodeId) {
          // Find the next node in the flow
          const nextNode = nodes.find((n: any) => n.id === nextNodeId);

          if (nextNode) {
            const scheduledFor = result.delayUntil || new Date().toISOString();

            await supabase.from("automation_jobs").insert({
              organization_id: job.organization_id,
              automation_id: job.automation_id,
              run_id: job.run_id,
              node_id: nextNode.id,
              job_type: nextNode.type || "action",
              payload: {
                node_config: nextNode.data?.config || {},
                node_label: nextNode.data?.label || "",
              },
              scheduled_for: scheduledFor,
              status: "pending",
              attempts: 0,
            });

            // If there's a delay, mark run as waiting
            if (result.delayUntil) {
              await supabase
                .from("automation_runs")
                .update({ status: "waiting", current_node_id: nextNode.id })
                .eq("id", job.run_id);
            }
          } else {
            // Next node not found — complete the run
            await completeRun(supabase, job);
          }
        } else {
          // No next node — find default outgoing edge
          const outEdges = edges.filter((e: any) => e.source === job.node_id);

          if (outEdges.length > 0) {
            const defaultNext = nodes.find((n: any) => n.id === outEdges[0].target);
            if (defaultNext) {
              await supabase.from("automation_jobs").insert({
                organization_id: job.organization_id,
                automation_id: job.automation_id,
                run_id: job.run_id,
                node_id: defaultNext.id,
                job_type: defaultNext.type || "action",
                payload: {
                  node_config: defaultNext.data?.config || {},
                  node_label: defaultNext.data?.label || "",
                },
                scheduled_for: new Date().toISOString(),
                status: "pending",
                attempts: 0,
              });
            } else {
              await completeRun(supabase, job);
            }
          } else {
            // No outgoing edges — run is complete
            await completeRun(supabase, job);
          }
        }

        processed++;
      } catch (jobErr) {
        console.error(`[automation-worker] Job ${job.id} error:`, jobErr);

        const newAttempts = (job.attempts || 0) + 1;
        if (newAttempts >= MAX_ATTEMPTS) {
          await failJob(supabase, job, String(jobErr));
          // Also fail the run
          await supabase
            .from("automation_runs")
            .update({ status: "failed", last_error: `Job ${job.node_id} failed after ${MAX_ATTEMPTS} attempts: ${String(jobErr)}` })
            .eq("id", job.run_id);
        } else {
          // Reset to pending for retry
          await supabase
            .from("automation_jobs")
            .update({ status: "pending", last_error: String(jobErr), attempts: newAttempts })
            .eq("id", job.id);
        }

        failed++;
      }
    }

    return respond({
      ok: true,
      message: `Processed ${processed} jobs, ${failed} failed`,
      processed,
      failed,
    });
  } catch (err) {
    console.error("[automation-worker] Fatal error:", err);
    return respond({ ok: false, message: String(err) }, 500);
  }
});

// ── Types ──────────────────────────────────────────────

interface JobResult {
  status: "done" | "waiting";
  output: Record<string, unknown>;
  nextNodeId?: string;    // explicit next node (used by condition)
  delayUntil?: string;    // ISO string for delay scheduling
}

// ── Processors ─────────────────────────────────────────

function processDelay(node: any, job: any): JobResult {
  const config = job.payload?.node_config || node.data?.config || {};
  const amount = Number(config.amount) || 1;
  const unit = config.unit || "hours";

  let ms: number;
  switch (unit) {
    case "minutes": ms = amount * 60_000; break;
    case "hours":   ms = amount * 3_600_000; break;
    case "days":    ms = amount * 86_400_000; break;
    default:        ms = amount * 3_600_000;
  }

  const delayUntil = new Date(Date.now() + ms).toISOString();

  return {
    status: "waiting",
    output: { delay_amount: amount, delay_unit: unit, resume_at: delayUntil },
    delayUntil,
    // nextNodeId will be resolved from outgoing edges in the main loop
  };
}

async function processCondition(
  supabase: any,
  node: any,
  job: any,
  edges: any[]
): Promise<JobResult> {
  const config = job.payload?.node_config || node.data?.config || {};
  const field = config.field || "";
  const operator = config.operator || "equals";
  const value = config.value || "";

  // Load lead data from the run context
  const { data: run } = await supabase
    .from("automation_runs")
    .select("context, entity_id, entity_type")
    .eq("id", job.run_id)
    .single();

  const ctx = run?.context || {};
  const fieldValue = String(ctx[field] || "");
  let conditionMet = false;

  switch (operator) {
    case "equals":       conditionMet = fieldValue === value; break;
    case "not_equals":   conditionMet = fieldValue !== value; break;
    case "contains":     conditionMet = fieldValue.includes(value); break;
    case "not_contains": conditionMet = !fieldValue.includes(value); break;
    case "is_empty":     conditionMet = fieldValue === ""; break;
    case "is_not_empty": conditionMet = fieldValue !== ""; break;
    default:             conditionMet = false;
  }

  // Find correct outgoing edge: sourceHandle "true" or "false"
  const matchEdge = edges.find(
    (e: any) => e.source === node.id && e.sourceHandle === (conditionMet ? "true" : "false")
  );

  // Fallback: if no handle-based edge, use first outgoing edge
  const fallbackEdge = edges.find((e: any) => e.source === node.id);
  const nextNodeId = matchEdge?.target || (conditionMet ? fallbackEdge?.target : undefined);

  return {
    status: "done",
    output: {
      field,
      operator,
      expected: value,
      actual: fieldValue,
      condition_met: conditionMet,
      next_node: nextNodeId || null,
    },
    nextNodeId,
  };
}

function processAction(node: any, job: any): JobResult {
  const config = job.payload?.node_config || node.data?.config || {};
  return {
    status: "done",
    output: {
      action_type: config.actionType || "unknown",
      stub: true,
      message: "Action registered (execution not implemented yet)",
    },
  };
}

async function processMessage(supabase: any, node: any, job: any): Promise<JobResult> {
  const config = job.payload?.node_config || node.data?.config || {};
  const messageText = config.text || "";

  if (!messageText) {
    return {
      status: "done",
      output: { error: "Texto da mensagem vazio", skipped: true },
    };
  }

  // Load run context to get lead phone and resolve variables
  const { data: run } = await supabase
    .from("automation_runs")
    .select("context, entity_id, entity_type, organization_id")
    .eq("id", job.run_id)
    .single();

  if (!run) {
    return { status: "done", output: { error: "Run não encontrada", skipped: true } };
  }

  const ctx = run.context || {};
  const leadPhone = ctx.lead_phone || ctx.phone || ctx.whatsapp || "";

  if (!leadPhone) {
    return {
      status: "done",
      output: { error: "Lead sem telefone cadastrado", skipped: true },
    };
  }

  // Resolve template variables like {{lead_name}}
  const resolvedText = messageText
    .replace(/\{\{lead\.name\}\}/g, ctx.lead_name || ctx.name || "")
    .replace(/\{\{lead\.phone\}\}/g, leadPhone)
    .replace(/\{\{lead\.email\}\}/g, ctx.lead_email || ctx.email || "")
    .replace(/\{\{lead\.stage\}\}/g, ctx.stage_name || ctx.stage || "");

  // Call evolution-send edge function
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const sendRes = await fetch(`${supabaseUrl}/functions/v1/evolution-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseServiceKey}`,
    },
    body: JSON.stringify({
      organization_id: job.organization_id,
      to_e164: leadPhone,
      message: resolvedText,
      lead_id: run.entity_type === "lead" ? run.entity_id : null,
      automation_run_id: job.run_id,
    }),
  });

  const sendData = await sendRes.json();

  if (!sendRes.ok) {
    const errorMsg = sendData?.error || `HTTP ${sendRes.status}`;
    console.error(`[automation-worker] Message send failed:`, errorMsg);

    // Log the failure
    await supabase.from("automation_logs").insert({
      organization_id: job.organization_id,
      automation_id: job.automation_id,
      run_id: job.run_id,
      node_id: job.node_id,
      level: "error",
      message: `Falha ao enviar mensagem para ${leadPhone}: ${errorMsg}`,
      data: { phone: leadPhone, error: errorMsg, resolved_text: resolvedText },
    });

    // Throw so the retry mechanism kicks in
    throw new Error(`WhatsApp send failed: ${errorMsg}`);
  }

  return {
    status: "done",
    output: {
      sent: true,
      phone: leadPhone,
      resolved_text: resolvedText,
      message_id: sendData?.message_id || null,
    },
  };
}

// ── Helpers ────────────────────────────────────────────

async function failJob(supabase: any, job: any, error: string) {
  await supabase
    .from("automation_jobs")
    .update({ status: "failed", last_error: error })
    .eq("id", job.id);

  await supabase.from("automation_logs").insert({
    organization_id: job.organization_id,
    automation_id: job.automation_id,
    run_id: job.run_id,
    node_id: job.node_id,
    level: "error",
    message: `Falha no nó "${job.payload?.node_label || job.job_type}": ${error}`,
    data: { error, attempts: job.attempts + 1 },
  });
}

async function completeRun(supabase: any, job: any) {
  await supabase
    .from("automation_runs")
    .update({ status: "completed", finished_at: new Date().toISOString() })
    .eq("id", job.run_id);

  await supabase.from("automation_logs").insert({
    organization_id: job.organization_id,
    automation_id: job.automation_id,
    run_id: job.run_id,
    node_id: job.node_id,
    level: "info",
    message: "Automação concluída com sucesso",
    data: { completed_at: new Date().toISOString() },
  });
}
