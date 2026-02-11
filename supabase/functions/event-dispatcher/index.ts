import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Fetch pending events (FIFO, max 50 per batch)
    const { data: events, error: fetchError } = await supabase
      .from("automation_events")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);

    if (fetchError) {
      console.error("[event-dispatcher] Fetch error:", fetchError);
      return respond({ ok: false, error: fetchError.message }, 500);
    }

    if (!events || events.length === 0) {
      return respond({ ok: true, processed: 0, message: "No pending events" });
    }

    console.log(`[event-dispatcher] Processing ${events.length} pending event(s)`);

    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const event of events) {
      try {
        const result = await processEvent(supabase, event);
        processed++;
        if (result.skipped > 0) skipped += result.skipped;
      } catch (err) {
        failed++;
        console.error(`[event-dispatcher] Event ${event.id} failed:`, err);
        await supabase
          .from("automation_events")
          .update({ status: "failed", processed_at: new Date().toISOString(), error: String(err) })
          .eq("id", event.id);
      }
    }

    return respond({ ok: true, processed, failed, skipped });
  } catch (err) {
    console.error("[event-dispatcher] Error:", err);
    return respond({ ok: false, error: String(err) }, 500);
  }
});

async function processEvent(supabase: any, event: any) {
  const orgId = event.organization_id;
  const eventName = event.event_name;
  const source = event.source;
  const traceId = event.payload?.trace_id || `evt_${event.id.substring(0, 8)}`;

  console.log(`[AUTOMATION_CONSUME] trace_id=${traceId} event_type=${eventName} org_id=${orgId} event_id=${event.id}`);

  // ── Check conversation ai_state for anti-conflict ──
  if (event.conversation_id && source === "ai") {
    const { data: conv } = await supabase
      .from("conversations")
      .select("ai_state")
      .eq("id", event.conversation_id)
      .maybeSingle();

    if (conv?.ai_state === "human_active") {
      console.log(`[event-dispatcher] Event ${event.id} skipped: human_active on conversation`);
      await supabase
        .from("automation_events")
        .update({ status: "skipped", processed_at: new Date().toISOString(), error: "Blocked: human_active" })
        .eq("id", event.id);
      await updateExecution(supabase, orgId, traceId, "skipped", "human_active on conversation", { skipped_reason: "human_active" });
      return { skipped: 1 };
    }
  }

  // ── Find matching automations ──
  let automations: any[] = [];

  if (eventName === "inbound.first_message") {
    const { data } = await supabase
      .from("automations")
      .select("id, name, trigger_type, trigger_event_name, allow_ai_triggers, allow_human_triggers, throttle_seconds, channel")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .eq("trigger_type", "first_message");
    automations = data || [];
  } else {
    const { data } = await supabase
      .from("automations")
      .select("id, name, trigger_type, trigger_event_name, allow_ai_triggers, allow_human_triggers, throttle_seconds, channel")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .eq("trigger_type", "event")
      .eq("trigger_event_name", eventName);
    automations = data || [];
  }

  console.log(`[AUTOMATION_MATCH] trace_id=${traceId} active_count=${automations.length} candidates=[${automations.map((a: any) => `{id=${a.id.substring(0,8)},trigger_type=${a.trigger_type},name=${a.name}}`).join(",")}]`);

  if (!automations || automations.length === 0) {
    await supabase
      .from("automation_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("id", event.id);
    console.log(`[event-dispatcher] Event ${event.id} (${eventName}): no matching automations`);
    await updateExecution(supabase, orgId, traceId, "no_match", "No active automations matched", { automations_found: 0 });
    return { skipped: 0 };
  }

  let executedCount = 0;
  let skippedCount = 0;

  for (const automation of automations) {
    // ── Source permission check ──
    if (source === "ai" && !automation.allow_ai_triggers) {
      await logEventRun(supabase, event.id, automation.id, orgId, "skipped", "allow_ai_triggers=false");
      console.log(`[AUTOMATION_FILTER] trace_id=${traceId} automation_id=${automation.id.substring(0,8)} final_match=false fail_reason=allow_ai_triggers_false`);
      skippedCount++;
      continue;
    }
    if (source === "human" && !automation.allow_human_triggers) {
      await logEventRun(supabase, event.id, automation.id, orgId, "skipped", "allow_human_triggers=false");
      console.log(`[AUTOMATION_FILTER] trace_id=${traceId} automation_id=${automation.id.substring(0,8)} final_match=false fail_reason=allow_human_triggers_false`);
      skippedCount++;
      continue;
    }

    // ── Throttle check ──
    if (automation.throttle_seconds > 0) {
      const throttleCutoff = new Date(Date.now() - automation.throttle_seconds * 1000).toISOString();
      const { data: recentRuns } = await supabase
        .from("automation_event_runs")
        .select("id")
        .eq("automation_id", automation.id)
        .eq("organization_id", orgId)
        .eq("status", "success")
        .gte("started_at", throttleCutoff)
        .limit(1);

      if (recentRuns && recentRuns.length > 0) {
        await logEventRun(supabase, event.id, automation.id, orgId, "skipped", `Throttled (${automation.throttle_seconds}s)`);
        console.log(`[AUTOMATION_FILTER] trace_id=${traceId} automation_id=${automation.id.substring(0,8)} final_match=false fail_reason=throttled`);
        skippedCount++;
        continue;
      }
    }

    // ── First Message trigger: keyword matching (NO first-touch dedup here — webhook handles it) ──
    if (automation.trigger_type === "first_message") {
      const payload = event.payload || {};
      const phone = payload.phone || "";
      const messageBody = payload.message_body || "";
      const eventChannel = payload.channel || "whatsapp";

      // Channel filter: check if automation's flow trigger restricts channel
      const { data: flowForTrigger } = await supabase
        .from("automation_flows")
        .select("nodes")
        .eq("automation_id", automation.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const triggerNode = (flowForTrigger?.nodes || []).find((n: any) => n.type === "trigger");
      const triggerConfig = triggerNode?.data?.config || {};

      // Channel filter
      const triggerChannel = triggerConfig.channel || "all";
      if (triggerChannel !== "all" && triggerChannel !== eventChannel) {
        const reason = `Channel mismatch: ${eventChannel} != ${triggerChannel}`;
        await logEventRun(supabase, event.id, automation.id, orgId, "skipped", reason);
        console.log(`[AUTOMATION_FILTER] trace_id=${traceId} automation_id=${automation.id.substring(0,8)} channel_expected=${triggerChannel} channel_got=${eventChannel} final_match=false fail_reason=channel_mismatch`);
        await updateExecution(supabase, orgId, traceId, "filter_failed", reason, {
          automation_id: automation.id,
          automation_name: automation.name,
          channel_expected: triggerChannel,
          channel_got: eventChannel,
        });
        skippedCount++;
        continue;
      }

      // Keyword match
      if (triggerConfig.useKeyword) {
        const keyword = (triggerConfig.keyword || "").trim();
        const matchType = triggerConfig.matchType || "contains";
        const normalizedBody = messageBody.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
        const normalizedKeyword = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

        let matched = false;
        switch (matchType) {
          case "contains": matched = normalizedBody.includes(normalizedKeyword); break;
          case "equals": matched = normalizedBody === normalizedKeyword; break;
          case "starts_with": matched = normalizedBody.startsWith(normalizedKeyword); break;
          case "regex":
            try { matched = new RegExp(keyword, "i").test(messageBody); } catch { matched = false; }
            break;
          default: matched = normalizedBody.includes(normalizedKeyword);
        }

        console.log(`[AUTOMATION_FILTER] trace_id=${traceId} automation_id=${automation.id.substring(0,8)} channel_expected=${triggerChannel} channel_got=${eventChannel} keyword_filter_enabled=true keyword="${keyword}" match_type=${matchType} normalized_message_text="${normalizedBody.substring(0,80)}" keyword_matched=${matched} final_match=${matched}`);

        if (!matched) {
          const reason = `Keyword not matched: "${keyword}" (${matchType}) in "${normalizedBody.substring(0,60)}"`;
          await logEventRun(supabase, event.id, automation.id, orgId, "skipped", reason);
          await updateExecution(supabase, orgId, traceId, "keyword_not_matched", reason, {
            automation_id: automation.id,
            automation_name: automation.name,
            keyword,
            match_type: matchType,
            normalized_message: normalizedBody.substring(0, 200),
          });
          skippedCount++;
          continue;
        }
      } else {
        console.log(`[AUTOMATION_FILTER] trace_id=${traceId} automation_id=${automation.id.substring(0,8)} channel_expected=${triggerChannel} channel_got=${eventChannel} keyword_filter_enabled=false final_match=true`);
      }

      // NOTE: First-touch dedup is now handled by the webhook (publishFirstMessageEvent)
      // The webhook inserts the first-touch record BEFORE publishing the event
      // So we don't need to re-check/insert first-touch here
      console.log(`[event-dispatcher] First-touch already handled by webhook for ${phone} — proceeding with automation ${automation.name}`);
    }

    // ── Anti-conflict: block message-sending automations when human_active ──
    if (event.conversation_id) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("ai_state")
        .eq("id", event.conversation_id)
        .maybeSingle();

      if (conv?.ai_state === "human_active") {
        const { data: flow } = await supabase
          .from("automation_flows")
          .select("nodes")
          .eq("automation_id", automation.id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();

        const hasMessageNode = (flow?.nodes || []).some((n: any) => n.type === "message");
        if (hasMessageNode) {
          await logEventRun(supabase, event.id, automation.id, orgId, "skipped", "Blocked: has message node + human_active");
          skippedCount++;
          continue;
        }
      }
    }

    // ── Execute automation ──
    try {
      console.log(`[AUTOMATION_FIRE] trace_id=${traceId} automation_id=${automation.id}`);
      const runId = await logEventRun(supabase, event.id, automation.id, orgId, "pending", null);

      const entityId = event.lead_id || event.conversation_id || event.entity_id || event.id;
      const entityType = event.lead_id ? "lead" : event.conversation_id ? "conversation" : event.entity_type;

      const { data: run } = await supabase
        .from("automation_runs")
        .insert({
          organization_id: orgId,
          automation_id: automation.id,
          entity_id: entityId,
          entity_type: entityType,
          status: "pending",
          context: event.payload,
        })
        .select("id")
        .single();

      if (!run) {
        await updateEventRun(supabase, runId, "failed", "Could not create automation_run");
        continue;
      }

      // Get flow and create initial job
      const { data: flow } = await supabase
        .from("automation_flows")
        .select("nodes, edges, entry_node_id")
        .eq("automation_id", automation.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!flow) {
        await updateEventRun(supabase, runId, "failed", "No flow found");
        await supabase.from("automation_runs").update({ status: "failed", last_error: "No flow" }).eq("id", run.id);
        continue;
      }

      // Find entry node: skip trigger node, use first node connected to trigger
      const nodes = (flow.nodes as any[]) || [];
      const edges = (flow.edges as any[]) || [];
      const triggerNode = nodes.find((n: any) => n.type === "trigger");

      let firstActionNodeId: string | null = null;
      if (triggerNode) {
        const outEdge = edges.find((e: any) => e.source === triggerNode.id);
        if (outEdge) {
          firstActionNodeId = outEdge.target;
        }
      }

      // Fallback to entry_node_id or first node
      const entryNodeId = firstActionNodeId || flow.entry_node_id || nodes[0]?.id;
      if (!entryNodeId) {
        await updateEventRun(supabase, runId, "failed", "No entry node");
        await supabase.from("automation_runs").update({ status: "failed", last_error: "No entry node" }).eq("id", run.id);
        continue;
      }

      const entryNode = nodes.find((n: any) => n.id === entryNodeId);

      await supabase.from("automation_jobs").insert({
        organization_id: orgId,
        automation_id: automation.id,
        run_id: run.id,
        node_id: entryNodeId,
        job_type: entryNode?.type || "trigger",
        payload: {
          node_config: entryNode?.data?.config || {},
          node_label: entryNode?.data?.label || "",
          event_payload: event.payload,
          event_source: source,
        },
        scheduled_for: new Date().toISOString(),
        status: "pending",
        attempts: 0,
      });

      await supabase.from("automation_runs").update({ status: "running", current_node_id: entryNodeId }).eq("id", run.id);
      await updateEventRun(supabase, runId, "success", null);

      // Log
      await supabase.from("automation_logs").insert({
        organization_id: orgId,
        automation_id: automation.id,
        run_id: run.id,
        node_id: entryNodeId,
        level: "info",
        message: `Automação disparada por evento: ${eventName} (source: ${source})`,
        data: { event_id: event.id, event_name: eventName, source, trace_id: traceId },
      });

      // Update execution trace
      await updateExecution(supabase, orgId, traceId, "automation_fired", null, {
        automation_id: automation.id,
        automation_name: automation.name,
        run_id: run.id,
        entry_node_id: entryNodeId,
        entry_node_type: entryNode?.type,
      });

      executedCount++;
      console.log(`[AUTOMATION_ACTION] trace_id=${traceId} automation_id=${automation.id} action_type=run_created result=success run_id=${run.id}`);
    } catch (err) {
      console.error(`[AUTOMATION_ACTION] trace_id=${traceId} automation_id=${automation.id} result=error error_message=${err}`);
      await updateExecution(supabase, orgId, traceId, "error", String(err), { automation_id: automation.id });
    }
  }

  // Mark event as processed
  await supabase
    .from("automation_events")
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("id", event.id);

  // Invoke automation-worker to process the new jobs
  if (executedCount > 0) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      await fetch(`${supabaseUrl}/functions/v1/automation-worker`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({}),
      });
    } catch { /* non-critical */ }
  }

  return { skipped: skippedCount };
}

async function logEventRun(
  supabase: any,
  eventId: string,
  automationId: string,
  orgId: string,
  status: string,
  skippedReason: string | null
): Promise<string> {
  const { data } = await supabase
    .from("automation_event_runs")
    .insert({
      automation_event_id: eventId,
      automation_id: automationId,
      organization_id: orgId,
      status,
      skipped_reason: skippedReason,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  return data?.id;
}

async function updateEventRun(supabase: any, runId: string, status: string, error: string | null) {
  if (!runId) return;
  await supabase
    .from("automation_event_runs")
    .update({ status, finished_at: new Date().toISOString(), error })
    .eq("id", runId);
}

// ── Update automation_executions trace ──
async function updateExecution(
  supabase: any,
  orgId: string,
  traceId: string,
  status: string,
  failReason: string | null,
  extraDebug: Record<string, unknown>,
) {
  try {
    // Try to update existing execution first
    const { data: existing } = await supabase
      .from("automation_executions")
      .select("id, debug_json")
      .eq("organization_id", orgId)
      .eq("trace_id", traceId)
      .maybeSingle();

    if (existing) {
      const mergedDebug = { ...(existing.debug_json || {}), ...extraDebug, [`step_${status}`]: new Date().toISOString() };
      await supabase
        .from("automation_executions")
        .update({ status, fail_reason: failReason, debug_json: mergedDebug })
        .eq("id", existing.id);
    } else {
      // Create new execution record
      await supabase.from("automation_executions").insert({
        organization_id: orgId,
        trace_id: traceId,
        event_name: "inbound.first_message",
        status,
        fail_reason: failReason,
        debug_json: { ...extraDebug, [`step_${status}`]: new Date().toISOString() },
      });
    }
  } catch { /* non-critical */ }
}
