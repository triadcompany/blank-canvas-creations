import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { matchKeyword } from "../_shared/normalize-text.ts";

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

  // ── ALWAYS create execution record at "received" step ──
  await upsertExecution(supabase, orgId, traceId, eventName, "received", null, {
    event_id: event.id,
    event_name: eventName,
    source,
    phone: event.payload?.phone || null,
    message_body: (event.payload?.message_body || "").substring(0, 200),
    channel: event.payload?.channel || null,
    step_received: new Date().toISOString(),
  });

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
      await upsertExecution(supabase, orgId, traceId, eventName, "skipped", "human_active on conversation", { skipped_reason: "human_active" });
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
  } else if (eventName === "deal.stage_changed") {
    // Match automations with trigger_type = deal_stage_changed OR event trigger listening to deal.stage_changed
    const { data: stageAutomations } = await supabase
      .from("automations")
      .select("id, name, trigger_type, trigger_event_name, allow_ai_triggers, allow_human_triggers, throttle_seconds, channel")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .in("trigger_type", ["deal_stage_changed", "event"])
      .or(`trigger_type.eq.deal_stage_changed,trigger_event_name.eq.deal.stage_changed`);
    
    // Filter deal_stage_changed triggers by stage match
    const payload = event.payload || {};
    const toStageName = (payload.to_stage_name || "").toLowerCase().trim();
    const toStageId = payload.to_stage_id || "";
    const pipelineId = payload.pipeline_id || "";
    
    const matchedAutomations: any[] = [];
    for (const auto of (stageAutomations || [])) {
      if (auto.trigger_type === "event" && auto.trigger_event_name === "deal.stage_changed") {
        matchedAutomations.push(auto);
        continue;
      }
      
      if (auto.trigger_type === "deal_stage_changed") {
        // Load flow to check trigger config
        const { data: flowData } = await supabase
          .from("automation_flows")
          .select("nodes")
          .eq("automation_id", auto.id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
        
        const trigNode = (flowData?.nodes || []).find((n: any) => n.type === "trigger");
        const trigConfig = trigNode?.data?.config || {};
        
        // Check stage match — prefer ID, fallback to name for legacy automations
        const configStageId = trigConfig.stage_id || "";
        const configStageName = (trigConfig.stage || "").toLowerCase().trim();
        
        if (configStageId) {
          // New: compare by UUID
          if (configStageId !== toStageId) {
            console.log(`[event-dispatcher] Stage ID mismatch: "${configStageId}" vs "${toStageId}"`);
            continue;
          }
        } else if (configStageName) {
          // Legacy fallback: compare by name
          if (configStageName !== toStageName) {
            console.log(`[event-dispatcher] Stage name mismatch (legacy): "${configStageName}" vs "${toStageName}"`);
            continue;
          }
        }
        
        // Check pipeline match — prefer ID, fallback to name for legacy
        const configPipelineId = trigConfig.pipeline_id || "";
        const configPipelineName = (trigConfig.pipeline || "").toLowerCase().trim();
        
        if (configPipelineId) {
          if (configPipelineId !== pipelineId) {
            console.log(`[event-dispatcher] Pipeline ID mismatch: "${configPipelineId}" vs "${pipelineId}"`);
            continue;
          }
        } else if (configPipelineName) {
          const pipelineName = (payload.pipeline_name || "").toLowerCase().trim();
          if (configPipelineName !== pipelineName) {
            console.log(`[event-dispatcher] Pipeline name mismatch (legacy): "${configPipelineName}" vs "${pipelineName}"`);
            continue;
          }
        }
        
        matchedAutomations.push(auto);
      }
    }
    automations = matchedAutomations;
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
    await upsertExecution(supabase, orgId, traceId, eventName, "no_match", "NO_ACTIVE_AUTOMATION", { automations_found: 0 });
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

    // ── First Message trigger: keyword matching ──
    if (automation.trigger_type === "first_message") {
      const payload = event.payload || {};
      const phone = payload.phone || "";
      const messageBody = payload.message_body || "";
      const eventChannel = payload.channel || "whatsapp";

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
        const reason = `CHANNEL_MISMATCH: ${eventChannel} != ${triggerChannel}`;
        await logEventRun(supabase, event.id, automation.id, orgId, "skipped", reason);
        console.log(`[AUTOMATION_FILTER] trace_id=${traceId} automation_id=${automation.id.substring(0,8)} channel_expected=${triggerChannel} channel_got=${eventChannel} final_match=false fail_reason=channel_mismatch`);
        await upsertExecution(supabase, orgId, traceId, eventName, "filter_failed", reason, {
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
        // Default true for ignore_accents_case (backwards-compatible)
        const ignoreAccentsCase = triggerConfig.ignore_accents_case !== false;

        const result = matchKeyword(messageBody, keyword, matchType, ignoreAccentsCase);

        console.log(`[AUTOMATION_FILTER] trace_id=${traceId} automation_id=${automation.id.substring(0,8)} channel_expected=${triggerChannel} channel_got=${eventChannel} keyword_filter_enabled=true keyword="${keyword}" match_type=${matchType} ignore_accents_case=${ignoreAccentsCase} normalization_applied=${result.normalizationApplied} normalized_message_text="${result.messageCompared.substring(0,80)}" keyword_matched=${result.matched} final_match=${result.matched}`);

        if (!result.matched) {
          const reason = `KEYWORD_NOT_MATCHED: "${keyword}" (${matchType}) in "${result.messageCompared.substring(0,60)}"`;
          await logEventRun(supabase, event.id, automation.id, orgId, "skipped", reason);
          await upsertExecution(supabase, orgId, traceId, eventName, "keyword_not_matched", reason, {
            automation_id: automation.id,
            automation_name: automation.name,
            keyword_raw: keyword,
            keyword_normalized: result.keywordCompared,
            match_type: matchType,
            ignore_accents_case: ignoreAccentsCase,
            normalization_applied: result.normalizationApplied,
            message_compared: result.normalizationApplied ? "normalized" : "raw",
            keyword_compared: result.normalizationApplied ? "normalized" : "raw",
            message_normalized: result.messageCompared.substring(0, 200),
            match_result: false,
          });
          skippedCount++;
          continue;
        }

        // Log successful match debug info
        await upsertExecution(supabase, orgId, traceId, eventName, "keyword_matched", null, {
          automation_id: automation.id,
          automation_name: automation.name,
          keyword_raw: keyword,
          keyword_normalized: result.keywordCompared,
          match_type: matchType,
          ignore_accents_case: ignoreAccentsCase,
          normalization_applied: result.normalizationApplied,
          message_compared: result.normalizationApplied ? "normalized" : "raw",
          keyword_compared: result.normalizationApplied ? "normalized" : "raw",
          message_normalized: result.messageCompared.substring(0, 200),
          match_result: true,
        });
      } else {
        console.log(`[AUTOMATION_FILTER] trace_id=${traceId} automation_id=${automation.id.substring(0,8)} channel_expected=${triggerChannel} channel_got=${eventChannel} keyword_filter_enabled=false final_match=true`);
      }

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

      await supabase.from("automation_logs").insert({
        organization_id: orgId,
        automation_id: automation.id,
        run_id: run.id,
        node_id: entryNodeId,
        level: "info",
        message: `Automação disparada por evento: ${eventName} (source: ${source})`,
        data: { event_id: event.id, event_name: eventName, source, trace_id: traceId },
      });

      await upsertExecution(supabase, orgId, traceId, eventName, "automation_fired", null, {
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
      await upsertExecution(supabase, orgId, traceId, eventName, "error", String(err), { automation_id: automation.id });
    }
  }

  // Mark event as processed
  await supabase
    .from("automation_events")
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("id", event.id);

  // ── Meta CAPI Mapping: auto-fire on deal.stage_changed ──
  if (eventName === "deal.stage_changed") {
    try {
      await processMetaCapiMappings(supabase, orgId, event.payload || {}, traceId);
    } catch (err) {
      console.error(`[event-dispatcher] Meta CAPI mapping error:`, err);
    }
  }

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

// ── Upsert automation_executions trace (ALWAYS persists) ──
async function upsertExecution(
  supabase: any,
  orgId: string,
  traceId: string,
  eventName: string,
  status: string,
  failReason: string | null,
  extraDebug: Record<string, unknown>,
) {
  try {
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
      await supabase.from("automation_executions").insert({
        organization_id: orgId,
        trace_id: traceId,
        event_name: eventName,
        status,
        fail_reason: failReason,
        debug_json: { ...extraDebug, [`step_${status}`]: new Date().toISOString() },
      });
    }
  } catch (err) {
    console.error("[event-dispatcher] upsertExecution error:", err);
  }
}

// ── SHA-256 helper ──
async function hashSHA256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── META CAPI MAPPINGS: Auto-fire CAPI events based on meta_event_mappings ──
async function processMetaCapiMappings(
  supabase: any,
  orgId: string,
  payload: any,
  traceId: string,
) {
  const pipelineId = payload.pipeline_id || "";
  const toStageId = payload.to_stage_id || "";
  const leadId = payload.lead_id || "";
  const phone = payload.phone || "";
  const email = payload.email || payload.lead_email || "";

  if (!toStageId) {
    console.log("[meta-capi-mapping] No to_stage_id in payload, skipping");
    return;
  }

  // 1. Check if Meta integration is enabled for this org
  const { data: metaConfig } = await supabase
    .from("meta_integrations")
    .select("pixel_id, access_token, is_active, test_mode, meta_test_event_code")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .maybeSingle();

  if (!metaConfig) {
    console.log("[meta-capi-mapping] Meta integration not active for org", orgId);
    return;
  }

  // 2. Find matching mappings
  let query = supabase
    .from("meta_event_mappings")
    .select("*")
    .eq("organization_id", orgId)
    .eq("stage_id", toStageId)
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (pipelineId) {
    query = query.eq("pipeline_id", pipelineId);
  }

  const { data: mappings, error: mapErr } = await query;

  if (mapErr || !mappings || mappings.length === 0) {
    console.log(`[meta-capi-mapping] No mappings for stage ${toStageId}`);
    return;
  }

  console.log(`[meta-capi-mapping] Found ${mappings.length} mapping(s) for stage ${toStageId}`);

  for (const mapping of mappings) {
    const eventName = mapping.meta_event_name;
    const dedupeKey = `${leadId || phone}_${eventName}_${toStageId}`;

    // 3. Deduplication check
    if (mapping.dedupe_enabled && leadId) {
      const cutoff = new Date(Date.now() - mapping.dedupe_window_hours * 3600 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("meta_capi_events")
        .select("id")
        .eq("organization_id", orgId)
        .eq("status", "success")
        .eq("event_id", dedupeKey)
        .gte("created_at", cutoff)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`[meta-capi-mapping] Deduplicated: ${eventName} for ${dedupeKey}`);
        // Log the skip
        await supabase.from("meta_capi_events").insert({
          organization_id: orgId,
          lead_id: leadId || null,
          deal_id: leadId || null,
          phone,
          event_name: eventName,
          event_id: dedupeKey + "_skip_" + Date.now(),
          event_time: new Date().toISOString(),
          status: "skipped",
          dedupe_skipped: true,
          source: "mapping",
          mapping_id: mapping.id,
          pipeline_id: pipelineId || null,
          stage_id: toStageId,
          trace_id: traceId,
          fail_reason: `Deduplicated: existing success within ${mapping.dedupe_window_hours}h`,
          attempts: 0,
        });

        await upsertExecution(supabase, orgId, traceId, "deal.stage_changed", "meta_capi_skipped", `Deduplicated: ${eventName}`, {
          meta_capi_attempted: false,
          meta_event_name: eventName,
          dedupe_skipped: true,
          dedupe_reason: `Existing success within ${mapping.dedupe_window_hours}h`,
        });
        continue;
      }
    }

    // 4. Create pending record
    const { data: capiRecord, error: insertErr } = await supabase
      .from("meta_capi_events")
      .insert({
        organization_id: orgId,
        lead_id: leadId || null,
        deal_id: leadId || null,
        phone,
        event_name: eventName,
        event_id: dedupeKey,
        event_time: new Date().toISOString(),
        status: "pending",
        source: "mapping",
        mapping_id: mapping.id,
        pipeline_id: pipelineId || null,
        stage_id: toStageId,
        trace_id: traceId,
        attempts: 0,
      })
      .select("id")
      .single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        console.log(`[meta-capi-mapping] Dedupe conflict for ${dedupeKey}`);
        continue;
      }
      console.error(`[meta-capi-mapping] Insert error:`, insertErr);
      continue;
    }

    // 5. Build and send payload
    const userData: Record<string, any> = {};
    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      const normalizedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
      userData.ph = [await hashSHA256(normalizedPhone)];
    }
    if (email) {
      userData.em = [await hashSHA256(email.toLowerCase().trim())];
    }

    const customData: Record<string, any> = {
      currency: "BRL",
      pipeline_id: pipelineId || null,
      stage_id: toStageId,
      stage_name: payload.to_stage_name || null,
      lead_source: payload.lead_source || null,
      seller_id: payload.seller_id || null,
      deal_id: leadId || null,
    };

    const eventTime = Math.floor(Date.now() / 1000);
    const metaPayload: any = {
      data: [{
        event_name: eventName,
        event_time: eventTime,
        event_id: dedupeKey,
        action_source: "system_generated",
        user_data: userData,
        custom_data: customData,
      }],
    };

    if (metaConfig.test_mode && metaConfig.meta_test_event_code) {
      metaPayload.test_event_code = metaConfig.meta_test_event_code;
    } else if (metaConfig.test_mode) {
      metaPayload.test_event_code = "TEST12345";
    }

    // 6. Send to Meta (with retries)
    const MAX_ATTEMPTS = 3;
    let success = false;
    let lastError = "";
    let responseJson: any = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const metaUrl = `https://graph.facebook.com/v20.0/${metaConfig.pixel_id}/events?access_token=${metaConfig.access_token}`;
        const metaResponse = await fetch(metaUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metaPayload),
        });

        responseJson = await metaResponse.json();

        if (metaResponse.ok) {
          success = true;
          break;
        } else {
          lastError = JSON.stringify(responseJson);
          console.warn(`[meta-capi-mapping] Attempt ${attempt} failed:`, lastError);
        }
      } catch (err: any) {
        lastError = err.message;
        console.warn(`[meta-capi-mapping] Attempt ${attempt} error:`, lastError);
      }

      await supabase.from("meta_capi_events").update({ attempts: attempt, fail_reason: lastError }).eq("id", capiRecord.id);

      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }

    // 7. Update final status
    // Sanitize payload for storage (remove access_token)
    const safePayload = { ...metaPayload };

    await supabase.from("meta_capi_events").update({
      status: success ? "success" : "failed",
      response_json: responseJson,
      payload_json: safePayload,
      fail_reason: success ? null : lastError,
      attempts: MAX_ATTEMPTS,
    }).eq("id", capiRecord.id);

    // 8. Update execution debug
    await upsertExecution(supabase, orgId, traceId, "deal.stage_changed", success ? "meta_capi_success" : "meta_capi_failed", success ? null : lastError, {
      meta_capi_attempted: true,
      meta_event_name: eventName,
      meta_response_status: success ? "ok" : "error",
      meta_response_body: JSON.stringify(responseJson || {}).substring(0, 500),
      dedupe_skipped: false,
      mapping_id: mapping.id,
    });

    console.log(`[meta-capi-mapping] ${eventName} → ${success ? "SUCCESS" : "FAILED"} for lead ${leadId}`);
  }
}
