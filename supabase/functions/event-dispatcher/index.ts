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
      return { skipped: 1 };
    }
  }

  // ── Find matching automations ──
  // For "inbound.first_message" events, match automations with trigger_type "first_message"
  // For other events, match automations with trigger_type "event" and matching trigger_event_name
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

  if (!automations || automations.length === 0) {
    // No matching automations — mark as processed (nothing to do)
    await supabase
      .from("automation_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("id", event.id);
    console.log(`[event-dispatcher] Event ${event.id} (${eventName}): no matching automations`);
    return { skipped: 0 };
  }

  let executedCount = 0;
  let skippedCount = 0;

  for (const automation of automations) {
    // ── Source permission check ──
    if (source === "ai" && !automation.allow_ai_triggers) {
      await logEventRun(supabase, event.id, automation.id, orgId, "skipped", "allow_ai_triggers=false");
      skippedCount++;
      continue;
    }
    if (source === "human" && !automation.allow_human_triggers) {
      await logEventRun(supabase, event.id, automation.id, orgId, "skipped", "allow_human_triggers=false");
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
        skippedCount++;
        continue;
      }
    }

    // ── First Message trigger: keyword matching + first-touch dedup ──
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
        await logEventRun(supabase, event.id, automation.id, orgId, "skipped", `Channel mismatch: ${eventChannel} != ${triggerChannel}`);
        skippedCount++;
        continue;
      }

      // Keyword match
      if (triggerConfig.useKeyword) {
        const keyword = (triggerConfig.keyword || "").trim();
        const matchType = triggerConfig.matchType || "contains";
        const normalizedBody = messageBody.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const normalizedKeyword = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

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

        if (!matched) {
          await logEventRun(supabase, event.id, automation.id, orgId, "skipped", `Keyword not matched: "${keyword}" (${matchType})`);
          skippedCount++;
          continue;
        }
      }

      // First-touch dedup: insert record (skip if already exists)
      const { error: ftErr } = await supabase
        .from("whatsapp_first_touch")
        .insert({ organization_id: orgId, phone, first_message_id: event.id });

      if (ftErr) {
        if (ftErr.code === "23505") {
          await logEventRun(supabase, event.id, automation.id, orgId, "skipped", "First-touch already exists");
          skippedCount++;
          continue;
        }
        console.error(`[event-dispatcher] First-touch insert error:`, ftErr);
      }

      console.log(`[event-dispatcher] First-touch recorded for ${phone} — proceeding with automation ${automation.name}`);
    }

    // ── Anti-conflict: block message-sending automations when human_active ──
    if (event.conversation_id) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("ai_state")
        .eq("id", event.conversation_id)
        .maybeSingle();

      if (conv?.ai_state === "human_active") {
        // Check if automation flow has message nodes
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

    // ── Execute automation via automation-trigger ──
    try {
      const runId = await logEventRun(supabase, event.id, automation.id, orgId, "pending", null);

      // Create an automation run
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

      const entryNodeId = flow.entry_node_id || (flow.nodes as any[])?.[0]?.id;
      if (!entryNodeId) {
        await updateEventRun(supabase, runId, "failed", "No entry node");
        await supabase.from("automation_runs").update({ status: "failed", last_error: "No entry node" }).eq("id", run.id);
        continue;
      }

      const entryNode = (flow.nodes as any[])?.find((n: any) => n.id === entryNodeId);

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
        data: { event_id: event.id, event_name: eventName, source },
      });

      executedCount++;
      console.log(`[event-dispatcher] Automation ${automation.name} triggered for event ${event.id}`);
    } catch (err) {
      console.error(`[event-dispatcher] Automation ${automation.id} execution error:`, err);
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
