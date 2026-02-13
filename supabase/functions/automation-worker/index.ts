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
      // Update heartbeat even if nothing to process
      await upsertHeartbeat(supabase, 0, 0);
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
            result = await processAction(supabase, currentNode, job);
            break;
          case "message":
            result = await processMessage(supabase, currentNode, job);
            break;
          case "wait_for_reply":
            result = await processWaitForReply(supabase, currentNode, job, edges);
            break;
          case "wait_for_reply_timeout":
            result = await processWaitForReplyTimeout(supabase, currentNode, job, edges);
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

        // Log execution (skip for wait_for_reply types — they log themselves)
        if (job.job_type !== "wait_for_reply" && job.job_type !== "wait_for_reply_timeout") {
          await supabase.from("automation_logs").insert({
            organization_id: job.organization_id,
            automation_id: job.automation_id,
            run_id: job.run_id,
            node_id: job.node_id,
            level: "info",
            message: `Nó "${currentNode.data?.label || job.job_type}" executado com sucesso`,
            data: { job_type: job.job_type, output: result.output },
          });
        }

        // If paused (wait_for_reply), skip next-node scheduling entirely
        if (result.nextNodeId === "__pause__") {
          processed++;
          continue;
        }

        // Update run current_node_id
        await supabase
          .from("automation_runs")
          .update({ current_node_id: job.node_id })
          .eq("id", job.run_id);

        // Determine next node(s) and schedule
        const nextNodeId = result.nextNodeId;

        if (nextNodeId) {
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
            if (result.delayUntil) {
              await supabase
                .from("automation_runs")
                .update({ status: "waiting", current_node_id: nextNode.id })
                .eq("id", job.run_id);
            }
          } else {
            await completeRun(supabase, job);
          }
        } else {
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
            await completeRun(supabase, job);
          }
        }

        processed++;
      } catch (jobErr) {
        console.error(`[automation-worker] Job ${job.id} error:`, jobErr);

        const newAttempts = (job.attempts || 0) + 1;
        if (newAttempts >= MAX_ATTEMPTS) {
          await failJob(supabase, job, String(jobErr));
          await supabase
            .from("automation_runs")
            .update({ status: "failed", last_error: `Job ${job.node_id} failed after ${MAX_ATTEMPTS} attempts: ${String(jobErr)}` })
            .eq("id", job.run_id);
        } else {
          await supabase
            .from("automation_jobs")
            .update({ status: "pending", last_error: String(jobErr), attempts: newAttempts })
            .eq("id", job.id);
        }

        failed++;
      }
    }

    // Update heartbeat
    await upsertHeartbeat(supabase, processed, failed);

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
  nextNodeId?: string;
  delayUntil?: string;
}

// ── Heartbeat ──────────────────────────────────────────

async function upsertHeartbeat(supabase: any, processed: number, failed: number) {
  try {
    await supabase.rpc("upsert_worker_heartbeat", {
      p_worker_name: "automation-worker",
      p_processed: processed,
      p_errors: failed,
    }).catch(async () => {
      // Fallback: direct upsert
      const { data: existing } = await supabase
        .from("worker_heartbeats")
        .select("worker_name")
        .eq("worker_name", "automation-worker")
        .maybeSingle();

      if (existing) {
        await supabase
          .from("worker_heartbeats")
          .update({
            last_run_at: new Date().toISOString(),
            processed_count: processed,
            error_count: failed,
          })
          .eq("worker_name", "automation-worker");
      } else {
        await supabase
          .from("worker_heartbeats")
          .insert({
            worker_name: "automation-worker",
            last_run_at: new Date().toISOString(),
            processed_count: processed,
            error_count: failed,
          });
      }
    });
  } catch { /* non-critical */ }
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
  };
}

async function processCondition(
  supabase: any,
  node: any,
  job: any,
  edges: any[]
): Promise<JobResult> {
  const config = job.payload?.node_config || node.data?.config || {};
  const conditionType = config.conditionType || "";

  // For "first_touch" condition type, always pass (webhook already validated)
  if (conditionType === "first_touch") {
    const yesEdge = edges.find(
      (e: any) => e.source === node.id && (e.sourceHandle === "yes" || e.sourceHandle === "true")
    );
    const fallbackEdge = edges.find((e: any) => e.source === node.id);
    const nextNodeId = yesEdge?.target || fallbackEdge?.target;

    return {
      status: "done",
      output: { condition_type: "first_touch", condition_met: true, reason: "Validated by webhook" },
      nextNodeId,
    };
  }

  const field = config.field || "";
  const operator = config.operator || "equals";
  const value = config.value || "";

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

  const matchEdge = edges.find(
    (e: any) => e.source === node.id && e.sourceHandle === (conditionMet ? "true" : "false")
  );
  const fallbackEdge = edges.find((e: any) => e.source === node.id);
  const nextNodeId = matchEdge?.target || (conditionMet ? fallbackEdge?.target : undefined);

  return {
    status: "done",
    output: { field, operator, expected: value, actual: fieldValue, condition_met: conditionMet, next_node: nextNodeId || null },
    nextNodeId,
  };
}

async function processAction(supabase: any, node: any, job: any): Promise<JobResult> {
  const config = job.payload?.node_config || node.data?.config || {};
  const actionType = config.actionType || "unknown";

  switch (actionType) {
    case "move_stage":
      return await processActionMoveStage(supabase, config, job);
    case "create_lead":
    case "create_deal":
      return await processActionCreateLead(supabase, config, job);
    case "send_meta_event":
      return await processActionSendMetaEvent(supabase, config, job);
    case "end_automation":
      await completeRun(supabase, job);
      return { status: "done", output: { action_type: "end_automation", ended: true } };
    default:
      return {
        status: "done",
        output: {
          action_type: actionType,
          stub: true,
          message: "Action registered (execution not implemented yet)",
        },
      };
  }
}

// ── CREATE LEAD / CREATE DEAL ─────────────────────────
// Allowed columns for the `leads` table (schema-safe insert)
const LEAD_ALLOWED_FIELDS = [
  "organization_id", "name", "phone", "email", "source",
  "observations", "stage_id", "seller_id", "created_by",
  "created_at", "updated_at", "interest", "price",
  "valor_negocio", "servico", "cidade", "estado", "assigned_to",
  "lead_source_id",
];

function filterLeadPayload(payload: Record<string, unknown>) {
  const filtered: Record<string, unknown> = {};
  const dropped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (LEAD_ALLOWED_FIELDS.includes(key)) {
      filtered[key] = value;
    } else {
      dropped[key] = value;
    }
  }
  return { filtered, dropped };
}

// ── Seller / Owner resolution ─────────────────────────
async function resolveSellerOrOwner(
  supabase: any,
  orgId: string,
  ownerId: string | null,
  automationCreatedBy: string | null,
): Promise<{ sellerId: string | null; strategy: string; distributionRuleId?: string; distributionCandidates?: number }> {

  // A) Manual selection
  if (ownerId) {
    return { sellerId: ownerId, strategy: "manual" };
  }

  // B) Try lead distribution (round-robin)
  try {
    const { data: distSettings } = await supabase
      .from("lead_distribution_settings")
      .select("id, mode, manual_receiver_id, rr_cursor, is_auto_distribution_enabled")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (distSettings?.is_auto_distribution_enabled) {
      if (distSettings.mode === "manual" && distSettings.manual_receiver_id) {
        return { sellerId: distSettings.manual_receiver_id, strategy: "distribution", distributionRuleId: distSettings.id };
      }

      // Round-robin: get active users
      const { data: distUsers } = await supabase
        .from("lead_distribution_users")
        .select("user_id, order_position")
        .eq("distribution_setting_id", distSettings.id)
        .eq("is_active", true)
        .order("order_position");

      if (distUsers && distUsers.length > 0) {
        const cursor = distSettings.rr_cursor || 0;
        const idx = cursor % distUsers.length;
        const chosen = distUsers[idx];

        // Advance cursor
        await supabase
          .from("lead_distribution_settings")
          .update({ rr_cursor: cursor + 1 })
          .eq("id", distSettings.id);

        return {
          sellerId: chosen.user_id,
          strategy: "distribution",
          distributionRuleId: distSettings.id,
          distributionCandidates: distUsers.length,
        };
      }
    }
  } catch (e) {
    console.warn("[automation-worker] Distribution lookup failed:", e);
  }

  // C) Fallback 1: automation creator
  if (automationCreatedBy) {
    const { data: creatorProfile } = await supabase
      .from("users_profile")
      .select("id")
      .eq("id", automationCreatedBy)
      .maybeSingle();
    if (creatorProfile) {
      return { sellerId: creatorProfile.id, strategy: "fallback_created_by" };
    }
  }

  // D) Fallback 2: first active seller in org (via org_members + profiles)
  const { data: sellerMembers } = await supabase
    .from("org_members")
    .select("clerk_user_id")
    .eq("organization_id", orgId)
    .eq("role", "seller")
    .eq("status", "active")
    .limit(10);

  if (sellerMembers && sellerMembers.length > 0) {
    const clerkIds = sellerMembers.map((m: any) => m.clerk_user_id);
    const { data: sellerProfile } = await supabase
      .from("users_profile")
      .select("id")
      .in("clerk_user_id", clerkIds)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (sellerProfile) {
      return { sellerId: sellerProfile.id, strategy: "fallback_first_seller" };
    }
  }

  // E) Fallback 3: first active admin (via org_members + profiles)
  const { data: adminMembers } = await supabase
    .from("org_members")
    .select("clerk_user_id")
    .eq("organization_id", orgId)
    .eq("role", "admin")
    .eq("status", "active")
    .limit(10);

  if (adminMembers && adminMembers.length > 0) {
    const clerkIds = adminMembers.map((m: any) => m.clerk_user_id);
    const { data: adminProfile } = await supabase
      .from("users_profile")
      .select("id")
      .in("clerk_user_id", clerkIds)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (adminProfile) {
      return { sellerId: adminProfile.id, strategy: "fallback_first_admin" };
    }
  }

  return { sellerId: null, strategy: "none_found" };
}

async function processActionCreateLead(supabase: any, config: any, job: any): Promise<JobResult> {
  const params = config.params || {};
  const source = params.source || "Automação";
  const sourceDetail = params.source_detail || "";
  const pipelineId = params.pipeline_id || null;
  const stageId = params.stage_id || null;
  const priority = params.priority ?? 0;
  const ownerId = params.owner_id || null;
  const deduplicate = params.deduplicate !== false; // default true

  // Load run context
  const { data: run } = await supabase
    .from("automation_runs")
    .select("context, entity_id, entity_type, organization_id")
    .eq("id", job.run_id)
    .single();

  if (!run) {
    return { status: "done", output: { error: "Run não encontrada", skipped: true } };
  }

  const orgId = run.organization_id;
  const ctx = run.context || {};
  const phone = ctx.phone || ctx.lead_phone || ctx.whatsapp || "";
  const contactName = ctx.contact_name || ctx.lead_name || ctx.name || phone || "Sem nome";
  const traceId = ctx.trace_id || job.payload?.event_payload?.trace_id;

  if (!phone) {
    return { status: "done", output: { error: "Sem telefone no contexto", skipped: true } };
  }

  // ── Resolve created_by (fallback chain) ──
  const actorUserId = ctx.actor_user_id || null;
  let resolvedCreatedBy: string | null = null;
  let createdByStrategy = "none_found";

  if (actorUserId) {
    resolvedCreatedBy = actorUserId;
    createdByStrategy = "actor_user";
  } else {
    // Fallback: automation creator
    let automationCreatedBy: string | null = null;
    const { data: automation } = await supabase
      .from("automations")
      .select("created_by")
      .eq("id", job.automation_id)
      .maybeSingle();
    if (automation && automation.created_by && automation.created_by !== "unknown") {
      // Validate it's a real profile UUID
      const { data: creatorProfile } = await supabase
        .from("users_profile")
        .select("id")
        .eq("id", automation.created_by)
        .maybeSingle();
      if (creatorProfile) {
        automationCreatedBy = creatorProfile.id;
      }
    }

    if (automationCreatedBy) {
      resolvedCreatedBy = automationCreatedBy;
      createdByStrategy = "automation_creator";
    } else {
      // Fallback: first admin in org (via org_members + users_profile)
      const { data: adminMembersForCreatedBy } = await supabase
        .from("org_members")
        .select("clerk_user_id")
        .eq("organization_id", orgId)
        .eq("role", "admin")
        .eq("status", "active")
        .limit(10);

      if (adminMembersForCreatedBy && adminMembersForCreatedBy.length > 0) {
        const clerkIds = adminMembersForCreatedBy.map((m: any) => m.clerk_user_id);
        const { data: adminFallback } = await supabase
          .from("users_profile")
          .select("id")
          .in("clerk_user_id", clerkIds)
          .order("created_at")
          .limit(1)
          .maybeSingle();
        
        if (adminFallback) {
          resolvedCreatedBy = adminFallback.id;
          createdByStrategy = "fallback_first_admin";
        }
      }
    }
  }

  console.log(`[automation-worker] created_by resolved: strategy=${createdByStrategy}, id=${resolvedCreatedBy}`);

  if (!resolvedCreatedBy) {
    const errMsg = "Organização sem admin ativo para atribuir created_by. Verifique os admins ativos da organização.";
    if (traceId) {
      await updateExecutionFromWorker(supabase, orgId, traceId, "failed", errMsg, {
        created_by_resolution: { strategy: createdByStrategy },
      });
    }
    return { status: "done", output: { error: errMsg, skipped: true } };
  }

  // ── Resolve seller_id (fallback chain) ──
  // Use resolvedCreatedBy as additional fallback for seller
  const sellerResolution = await resolveSellerOrOwner(supabase, orgId, ownerId, resolvedCreatedBy);
  const resolvedSellerId = sellerResolution.sellerId;

  console.log(`[automation-worker] Seller resolved: strategy=${sellerResolution.strategy}, seller_id=${resolvedSellerId}`);

  // ── Resolve pipeline + stage ──
  let resolvedPipelineId = pipelineId;
  let resolvedStageId = stageId;

  if (!resolvedPipelineId) {
    const { data: defPipeline } = await supabase
      .from("pipelines")
      .select("id")
      .eq("organization_id", orgId)
      .eq("is_default", true)
      .eq("is_active", true)
      .maybeSingle();
    resolvedPipelineId = defPipeline?.id || null;

    if (!resolvedPipelineId) {
      const { data: anyPipeline } = await supabase
        .from("pipelines")
        .select("id")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      resolvedPipelineId = anyPipeline?.id || null;
    }
  }

  if (!resolvedStageId && resolvedPipelineId) {
    const { data: firstStage } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", resolvedPipelineId)
      .order("position")
      .limit(1)
      .maybeSingle();
    resolvedStageId = firstStage?.id || null;
  }

  if (!resolvedPipelineId) {
    return { status: "done", output: { error: "Nenhum pipeline encontrado na organização", skipped: true } };
  }

  // ── STEP A: Upsert/find Lead (contact only) ──
  let leadId: string | null = null;
  let leadCreated = false;

  // Try to find existing lead by phone + org
  const { data: existingLead } = await supabase
    .from("leads")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();

  if (existingLead) {
    leadId = existingLead.id;
    console.log(`[automation-worker] Lead found: ${leadId} (${existingLead.name}) for ${phone}`);
  } else {
    // ── Resolve interest from first message ──
    const rawMessageBody = ctx.message_body || ctx.message_text || "";
    const interestText = (rawMessageBody.trim() || "Lead criado automaticamente via primeira mensagem.").substring(0, 2000);

    // ── Resolve lead_source_id from source name ──
    let resolvedLeadSourceId: string | null = null;
    if (source && orgId) {
      const { data: matchedSource } = await supabase
        .from("lead_sources")
        .select("id")
        .eq("organization_id", orgId)
        .ilike("name", source)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (matchedSource) resolvedLeadSourceId = matchedSource.id;
    }

    // Create lead with ONLY contact-safe fields
    const rawLeadPayload: Record<string, unknown> = {
      organization_id: orgId,
      name: contactName,
      phone,
      source,
      email: ctx.email || null,
      stage_id: resolvedStageId,
      seller_id: resolvedSellerId,
      assigned_to: resolvedSellerId,
      created_by: resolvedCreatedBy,
      interest: interestText,
      lead_source_id: resolvedLeadSourceId,
    };

    const { filtered: safeLeadPayload, dropped: droppedFields } = filterLeadPayload(rawLeadPayload);

    if (Object.keys(droppedFields).length > 0) {
      console.log(`[automation-worker] Dropped fields from lead insert:`, droppedFields);
    }

    const { data: newLead, error: leadErr } = await supabase
      .from("leads")
      .insert(safeLeadPayload)
      .select("id, name")
      .single();

    if (leadErr) {
      console.error(`[automation-worker] Create lead error:`, leadErr);
      if (traceId) {
        await updateExecutionFromWorker(supabase, orgId, traceId, "failed", `Erro ao criar lead: ${leadErr.message}`, {
          lead_payload_sent: rawLeadPayload,
          lead_payload_filtered: safeLeadPayload,
          dropped_fields: droppedFields,
          seller_resolution: sellerResolution,
          error_stack: leadErr.message,
        });
      }
      throw new Error(`Erro ao criar lead: ${leadErr.message}`);
    }

    leadId = newLead.id;
    leadCreated = true;
    console.log(`[automation-worker] Lead created: ${leadId} (${contactName}) for ${phone}`);
  }

  // ── Deduplication check (on opportunities, not leads) ──
  if (deduplicate) {
    const { data: existingDeal } = await supabase
      .from("opportunities")
      .select("id, status")
      .eq("organization_id", orgId)
      .eq("lead_id", leadId)
      .eq("status", "open")
      .limit(1)
      .maybeSingle();

    if (existingDeal) {
      console.log(`[automation-worker] Dedup: open opportunity already exists for lead ${leadId} (opp_id=${existingDeal.id})`);
      if (traceId) {
        await updateExecutionFromWorker(supabase, orgId, traceId, "success", null, {
          lead_id_result: leadId,
          lead_created: leadCreated,
          deal_deduplicated: true,
          existing_opportunity_id: existingDeal.id,
          seller_resolution: sellerResolution,
          created_by_resolution: { strategy: createdByStrategy, id: resolvedCreatedBy },
          phone,
        });
      }
      return {
        status: "done",
        output: {
          action_type: "create_deal",
          deduplicated: true,
          lead_id: leadId,
          lead_created: leadCreated,
          existing_opportunity_id: existingDeal.id,
          seller_resolution: sellerResolution,
          phone,
        },
      };
    }
  }

  // ── STEP B: Create Opportunity (deal/negócio) ──
  const dealPayload = {
    organization_id: orgId,
    lead_id: leadId,
    pipeline_id: resolvedPipelineId,
    stage_id: resolvedStageId,
    priority: Number(priority) || 0,
    assigned_to: resolvedSellerId || null,
    source,
    source_detail: sourceDetail,
    status: "open",
  };

  const { data: newDeal, error: dealErr } = await supabase
    .from("opportunities")
    .insert(dealPayload)
    .select("id")
    .single();

  if (dealErr) {
    console.error(`[automation-worker] Create opportunity error:`, dealErr);
    if (traceId) {
      await updateExecutionFromWorker(supabase, orgId, traceId, "failed", `Erro ao criar negócio: ${dealErr.message}`, {
        lead_id_result: leadId,
        lead_created: leadCreated,
        deal_payload_sent: dealPayload,
        seller_resolution: sellerResolution,
        error_stack: dealErr.message,
      });
    }
    throw new Error(`Erro ao criar negócio: ${dealErr.message}`);
  }

  console.log(`[automation-worker] Opportunity created: ${newDeal.id} for lead ${leadId}`);

  // ── Link conversation to lead if possible ──
  if (ctx.conversation_id) {
    await supabase
      .from("conversations")
      .update({ lead_id: leadId })
      .eq("id", ctx.conversation_id)
      .is("lead_id", null);
  }

  // ── Also update lead.stage_id for kanban compatibility ──
  if (resolvedStageId) {
    await supabase
      .from("leads")
      .update({ stage_id: resolvedStageId, seller_id: resolvedSellerId, assigned_to: resolvedSellerId })
      .eq("id", leadId);
  }

  // Update execution trace
  if (traceId) {
    await updateExecutionFromWorker(supabase, orgId, traceId, "success", null, {
      lead_id_result: leadId,
      lead_created: leadCreated,
      deal_id_result: newDeal.id,
      deal_payload_sent: dealPayload,
      seller_resolution: sellerResolution,
      created_by_resolution: { strategy: createdByStrategy, id: resolvedCreatedBy },
      first_message_used: leadCreated,
      first_message_preview: leadCreated ? (ctx.message_body || ctx.message_text || "").substring(0, 120) : null,
      phone,
      pipeline_id: resolvedPipelineId,
      stage_id: resolvedStageId,
      source,
    });
  }

  return {
    status: "done",
    output: {
      action_type: "create_deal",
      lead_id: leadId,
      lead_created: leadCreated,
      opportunity_id: newDeal.id,
      seller_resolution: sellerResolution,
      created_by_resolution: { strategy: createdByStrategy, id: resolvedCreatedBy },
      phone,
      pipeline_id: resolvedPipelineId,
      stage_id: resolvedStageId,
      source,
      created: true,
    },
  };
}

async function updateExecutionFromWorker(
  supabase: any,
  orgId: string,
  traceId: string,
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
    }
  } catch { /* non-critical */ }
}

async function processActionMoveStage(supabase: any, config: any, job: any): Promise<JobResult> {
  const params = config.params || {};
  const stageName = params.stage || "";

  if (!stageName) {
    return { status: "done", output: { error: "Etapa de destino não configurada", skipped: true } };
  }

  const { data: run } = await supabase
    .from("automation_runs")
    .select("entity_id, entity_type, organization_id")
    .eq("id", job.run_id)
    .single();

  if (!run) {
    return { status: "done", output: { error: "Run não encontrada", skipped: true } };
  }

  const leadId = run.entity_type === "lead" ? run.entity_id : null;
  if (!leadId) {
    return { status: "done", output: { error: "Entidade não é um lead", skipped: true } };
  }

  const { data: stages } = await supabase
    .from("crm_stages")
    .select("id, name")
    .eq("organization_id", run.organization_id)
    .ilike("name", stageName);

  const targetStage = stages?.[0];
  if (!targetStage) {
    return {
      status: "done",
      output: { error: `Etapa "${stageName}" não encontrada`, skipped: true },
    };
  }

  const { error: updateErr } = await supabase
    .from("crm_leads")
    .update({ stage: targetStage.id, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("organization_id", run.organization_id);

  if (updateErr) {
    throw new Error(`Erro ao mover lead: ${updateErr.message}`);
  }

  return {
    status: "done",
    output: {
      action_type: "move_stage",
      lead_id: leadId,
      stage_id: targetStage.id,
      stage_name: targetStage.name,
      moved: true,
    },
  };
}

async function processMessage(supabase: any, node: any, job: any): Promise<JobResult> {
  const config = job.payload?.node_config || node.data?.config || {};
  const messageText = config.text || "";

  if (!messageText) {
    return { status: "done", output: { error: "Texto da mensagem vazio", skipped: true } };
  }

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
    return { status: "done", output: { error: "Lead sem telefone cadastrado", skipped: true } };
  }

  const resolvedText = messageText
    .replace(/\{\{lead\.name\}\}/g, ctx.lead_name || ctx.name || "")
    .replace(/\{\{lead\.phone\}\}/g, leadPhone)
    .replace(/\{\{lead\.email\}\}/g, ctx.lead_email || ctx.email || "")
    .replace(/\{\{lead\.stage\}\}/g, ctx.stage_name || ctx.stage || "");

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
    await supabase.from("automation_logs").insert({
      organization_id: job.organization_id,
      automation_id: job.automation_id,
      run_id: job.run_id,
      node_id: job.node_id,
      level: "error",
      message: `Falha ao enviar mensagem para ${leadPhone}: ${errorMsg}`,
      data: { phone: leadPhone, error: errorMsg, resolved_text: resolvedText },
    });
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

// ── Wait For Reply Processor ──────────────────────────

async function processWaitForReply(
  supabase: any,
  node: any,
  job: any,
  edges: any[]
): Promise<JobResult> {
  const config = job.payload?.node_config || node.data?.config || {};
  const timeoutAmount = Number(config.timeout_amount) || 24;
  const timeoutUnit = config.timeout_unit || "hours";

  let timeoutMs: number;
  switch (timeoutUnit) {
    case "minutes": timeoutMs = timeoutAmount * 60_000; break;
    case "hours":   timeoutMs = timeoutAmount * 3_600_000; break;
    case "days":    timeoutMs = timeoutAmount * 86_400_000; break;
    default:        timeoutMs = timeoutAmount * 3_600_000;
  }

  const now = new Date();
  const timeoutAt = new Date(now.getTime() + timeoutMs).toISOString();

  const { data: run } = await supabase
    .from("automation_runs")
    .select("entity_id, entity_type")
    .eq("id", job.run_id)
    .single();

  const leadId = run?.entity_type === "lead" ? run?.entity_id : null;

  await supabase
    .from("automation_runs")
    .update({ status: "paused", current_node_id: node.id })
    .eq("id", job.run_id);

  await supabase.from("automation_jobs").insert({
    organization_id: job.organization_id,
    automation_id: job.automation_id,
    run_id: job.run_id,
    node_id: node.id,
    job_type: "wait_for_reply_timeout",
    payload: {
      lead_id: leadId,
      since: now.toISOString(),
      timeout_at: timeoutAt,
      node_id: node.id,
      node_config: config,
    },
    scheduled_for: timeoutAt,
    status: "pending",
    attempts: 0,
  });

  await supabase.from("automation_logs").insert({
    organization_id: job.organization_id,
    automation_id: job.automation_id,
    run_id: job.run_id,
    node_id: node.id,
    level: "info",
    message: `Aguardando resposta do lead (timeout: ${timeoutAmount} ${timeoutUnit})`,
    data: { lead_id: leadId, timeout_at: timeoutAt },
  });

  return {
    status: "done",
    output: { paused: true, lead_id: leadId, timeout_at: timeoutAt, waiting_for: "reply" },
    nextNodeId: "__pause__",
  };
}

async function processWaitForReplyTimeout(
  supabase: any,
  node: any,
  job: any,
  edges: any[]
): Promise<JobResult> {
  const payload = job.payload || {};
  const leadId = payload.lead_id;

  let replied = false;
  if (leadId) {
    const { data: lead } = await supabase
      .from("leads")
      .select("last_reply_at")
      .eq("id", leadId)
      .single();

    if (lead?.last_reply_at) {
      const replyTime = new Date(lead.last_reply_at).getTime();
      const sinceTime = new Date(payload.since).getTime();
      replied = replyTime > sinceTime;
    }
  }

  const handleId = replied ? "replied" : "timeout";
  const logMessage = replied
    ? "Resposta recebida (detectada no timeout check)"
    : "Timeout sem resposta";

  const matchEdge = edges.find(
    (e: any) => e.source === node.id && e.sourceHandle === handleId
  );
  const nextNodeId = matchEdge?.target || undefined;

  await supabase
    .from("automation_runs")
    .update({ status: "running" })
    .eq("id", job.run_id);

  await supabase.from("automation_logs").insert({
    organization_id: job.organization_id,
    automation_id: job.automation_id,
    run_id: job.run_id,
    node_id: node.id,
    level: "info",
    message: logMessage,
    data: { lead_id: leadId, handle: handleId, next_node: nextNodeId || null },
  });

  return {
    status: "done",
    output: { handle: handleId, replied, lead_id: leadId },
    nextNodeId,
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

// ── SEND META EVENT (CAPI) — NOW ENQUEUES TO event_dispatch_queue ────────────────────────────

async function hashSHA256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function processActionSendMetaEvent(supabase: any, config: any, job: any): Promise<JobResult> {
  const params = config.params || {};
  const eventName = params.event_name || "Lead";
  const sendOnce = params.send_once !== false;
  const value = params.value ? parseFloat(params.value) : undefined;
  const currency = params.currency || "BRL";

  // Load run context
  const { data: run } = await supabase
    .from("automation_runs")
    .select("context, entity_id, entity_type, organization_id")
    .eq("id", job.run_id)
    .single();

  if (!run) {
    return { status: "done", output: { error: "Run not found", skipped: true } };
  }

  const orgId = run.organization_id;
  const ctx = run.context || {};
  const leadId = ctx.lead_id || run.entity_id || null;
  const phone = ctx.phone || ctx.lead_phone || "";
  const email = ctx.email || ctx.lead_email || "";
  const traceId = ctx.trace_id || null;
  const leadName = ctx.lead_name || ctx.contact_name || "";
  const pipelineId = ctx.pipeline_id || null;
  const stageId = ctx.to_stage_id || null;

  // Fetch city/state from leads table if not in context
  let leadCity = ctx.lead_city || ctx.cidade || "";
  let leadState = ctx.lead_state || ctx.estado || "";
  if (leadId && (!leadCity || !leadState)) {
    const { data: leadRow } = await supabase
      .from("leads")
      .select("cidade, estado")
      .eq("id", leadId)
      .maybeSingle();
    if (leadRow) {
      if (!leadCity && leadRow.cidade) leadCity = leadRow.cidade;
      if (!leadState && leadRow.estado) leadState = leadRow.estado;
    }
  }

  // Build dedupe_key: org:lead_or_phone:event:stage
  const entityKey = leadId || phone;
  const stageKey = sendOnce ? (stageId || "any") : "any";
  const dedupeKey = `${orgId}:${entityKey}:${eventName}:${stageKey}`;
  const eventHash = await hashSHA256(dedupeKey);

  // Check idempotency
  const { data: existing } = await supabase
    .from("event_dispatch_queue")
    .select("id, status")
    .eq("event_hash", eventHash)
    .in("status", ["pending", "processing", "success", "failed"])
    .limit(1);

  if (existing && existing.length > 0) {
    console.log(`[automation-worker] SKIPPED_DUPLICATE (hash=${eventHash.slice(0,12)}): ${eventName} for ${entityKey}`);

    // Update execution trace with dedup info
    if (traceId) {
      await updateExecutionFromWorker(supabase, orgId, traceId, "success", null, {
        action_type: "send_meta_event",
        event_name: eventName,
        dedupe_key: dedupeKey,
        queue_status_initial: "skipped_duplicate",
        existing_queue_id: existing[0].id,
        existing_queue_status: existing[0].status,
      });
    }

    return {
      status: "done",
      output: {
        action_type: "send_meta_event",
        deduplicated: true,
        event_name: eventName,
        dedupe_key: dedupeKey,
        queue_status_initial: "skipped_duplicate",
      },
    };
  }

  // Generate a stable event_id (UUID) that will be reused on retries for Meta dedup
  const eventId = crypto.randomUUID();

  // Enqueue the event
  const queuePayload = {
    event_name: eventName,
    event_id: eventId,
    lead_id: leadId,
    phone,
    email,
    name: leadName,
    value,
    currency,
    pipeline_id: pipelineId,
    stage_id: stageId,
    stage_name: ctx.to_stage_name || null,
    pipeline_name: ctx.pipeline_name || null,
    seller_name: ctx.seller_name || null,
    seller_id: ctx.seller_id || null,
    lead_source: ctx.lead_source || ctx.source || null,
    city: leadCity || null,
    state: leadState || null,
    trace_id: traceId,
    dedupe_key: dedupeKey,
    event_time: Math.floor(Date.now() / 1000),
  };

  const { data: inserted, error: insertErr } = await supabase.from("event_dispatch_queue").insert({
    organization_id: orgId,
    lead_id: leadId,
    event_name: eventName,
    channel: "meta_capi",
    payload: queuePayload,
    status: "pending",
    event_hash: eventHash,
    automation_id: job.automation_id,
    run_id: job.run_id,
    pipeline_id: pipelineId,
    stage_id: stageId,
  }).select("id").single();

  if (insertErr) {
    // Unique constraint violation = dedup
    if (insertErr.code === "23505") {
      console.log(`[automation-worker] SKIPPED_DUPLICATE on insert (hash=${eventHash.slice(0,12)})`);
      if (traceId) {
        await updateExecutionFromWorker(supabase, orgId, traceId, "success", null, {
          action_type: "send_meta_event",
          event_name: eventName,
          dedupe_key: dedupeKey,
          queue_status_initial: "skipped_duplicate",
        });
      }
      return {
        status: "done",
        output: { action_type: "send_meta_event", deduplicated: true, event_name: eventName, dedupe_key: dedupeKey },
      };
    }
    throw new Error(`Failed to enqueue event: ${insertErr.message}`);
  }

  const queueId = inserted?.id || null;
  console.log(`[automation-worker] ✅ Event enqueued: ${eventName} for ${entityKey} (queue_id=${queueId})`);

  // Update execution trace
  if (traceId) {
    await updateExecutionFromWorker(supabase, orgId, traceId, "success", null, {
      action_type: "send_meta_event",
      event_name: eventName,
      dedupe_key: dedupeKey,
      queue_id: queueId,
      queue_status_initial: "pending",
    });
  }

  return {
    status: "done",
    output: {
      action_type: "send_meta_event",
      event_name: eventName,
      enqueued: true,
      queue_id: queueId,
      dedupe_key: dedupeKey,
      queue_status_initial: "pending",
      lead_id: leadId,
    },
  };
}
