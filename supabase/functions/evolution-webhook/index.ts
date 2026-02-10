import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const webhookSecret = Deno.env.get("EVOLUTION_WEBHOOK_SECRET");
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // Optional webhook secret validation via query param or header
    if (webhookSecret) {
      const url = new URL(req.url);
      const tokenParam = url.searchParams.get("token");
      const tokenHeader = req.headers.get("x-webhook-secret");
      if (tokenParam !== webhookSecret && tokenHeader !== webhookSecret) {
        console.warn("[evolution-webhook] Invalid webhook secret");
        return respond({ ok: false, error: "unauthorized" }, 401);
      }
    }

    const body = await req.json();
    console.log("[evolution-webhook] Event received:", JSON.stringify(body).substring(0, 500));

    const event = body.event || body.action;
    const instanceName = body.instance || body.instanceName;

    // Find integration by instance name
    const { data: integration } = await supabase
      .from("whatsapp_integrations")
      .select("id, organization_id, status")
      .eq("instance_name", instanceName)
      .maybeSingle();

    if (!integration) {
      console.log("[evolution-webhook] Unknown instance:", instanceName);
      return respond({ ok: true, message: "unknown instance" });
    }

    const orgId = integration.organization_id;

    // ── CONNECTION UPDATE ──
    if (event === "CONNECTION_UPDATE" || event === "connection.update") {
      return await handleConnectionUpdate(supabase, body, integration);
    }

    // ── QR CODE UPDATE ──
    if (event === "QRCODE_UPDATED" || event === "qrcode.updated") {
      return await handleQrCodeUpdate(supabase, body, integration);
    }

    // ── INBOUND MESSAGES ──
    if (event === "MESSAGES_UPSERT" || event === "messages.upsert") {
      return await handleInboundMessages(supabase, body, orgId, instanceName);
    }

    return respond({ ok: true });
  } catch (err) {
    console.error("[evolution-webhook] Error:", err);
    return respond({ ok: true });
  }
});

// ── CONNECTION UPDATE handler ──
async function handleConnectionUpdate(supabase: any, body: any, integration: any) {
  const state = body.data?.state || body.state;
  let newStatus = "disconnected";
  let connectedAt: string | null = null;
  let phoneNumber: string | null = null;

  if (state === "open") {
    newStatus = "connected";
    connectedAt = new Date().toISOString();
    phoneNumber = body.data?.phoneNumber || body.data?.wid?.user || null;
  } else if (state === "connecting") {
    newStatus = "qr_pending";
  } else if (state === "close") {
    newStatus = "disconnected";
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };
  if (connectedAt) {
    updateData.connected_at = connectedAt;
    updateData.qr_code_data = null;
  }
  if (phoneNumber) updateData.phone_number = phoneNumber;
  if (newStatus === "disconnected") {
    updateData.qr_code_data = null;
    updateData.connected_at = null;
    updateData.phone_number = null;
  }

  await supabase
    .from("whatsapp_integrations")
    .update(updateData)
    .eq("id", integration.id);

  console.log(`[evolution-webhook] Connection updated: ${newStatus}`);
  return respond({ ok: true, status: newStatus });
}

// ── QR CODE UPDATE handler ──
async function handleQrCodeUpdate(supabase: any, body: any, integration: any) {
  const qrCode = body.data?.qrcode?.base64 || body.data?.base64 || null;
  if (qrCode) {
    await supabase
      .from("whatsapp_integrations")
      .update({ qr_code_data: qrCode, status: "qr_pending", updated_at: new Date().toISOString() })
      .eq("id", integration.id);
    console.log("[evolution-webhook] QR code updated");
  }
  return respond({ ok: true });
}

// ── INBOUND MESSAGES handler ──
async function handleInboundMessages(supabase: any, body: any, orgId: string, instanceName: string) {
  const messages = body.data || [];
  const msgArray = Array.isArray(messages) ? messages : [messages];

  for (const msg of msgArray) {
    if (msg.key?.fromMe) continue;

    const phone = (msg.key?.remoteJid || "")
      .replace("@s.whatsapp.net", "")
      .replace("@c.us", "");
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption || "";
    const pushName = msg.pushName || "";

    if (!phone) continue;

    const normalizedPhone = phone.replace(/[\s\-\+\(\)]/g, "");
    const now = new Date().toISOString();
    const messagePreview = (text || "(mídia)").substring(0, 100);

    // ── 1) UPSERT whatsapp_thread (Inbox) ──
    let threadId: string | null = null;
    let isNewThread = false;

    const { data: existingThread } = await supabase
      .from("whatsapp_threads")
      .select("id, contact_name, assigned_user_id")
      .eq("organization_id", orgId)
      .eq("contact_phone_e164", normalizedPhone)
      .maybeSingle();

    if (existingThread) {
      threadId = existingThread.id;
      const threadUpdate: Record<string, unknown> = {
        last_message_at: now,
        last_message_preview: messagePreview,
        instance_name: instanceName,
      };
      if (pushName && !existingThread.contact_name) {
        threadUpdate.contact_name = pushName;
      }
      threadUpdate.status = "open";

      await supabase
        .from("whatsapp_threads")
        .update(threadUpdate)
        .eq("id", threadId);
    } else {
      isNewThread = true;
      const { data: newThread } = await supabase
        .from("whatsapp_threads")
        .insert({
          organization_id: orgId,
          instance_name: instanceName,
          contact_phone_e164: normalizedPhone,
          contact_name: pushName || null,
          status: "open",
          assigned_user_id: null,
          last_message_at: now,
          last_message_preview: messagePreview,
        })
        .select("id")
        .single();

      threadId = newThread?.id || null;
      console.log(`[evolution-webhook] Thread created for ${normalizedPhone}: ${threadId}`);
    }

    // ── 1b) AUTO-ASSIGN via round-robin ──
    const shouldAutoAssign =
      (isNewThread || (existingThread && !existingThread.assigned_user_id)) &&
      threadId;

    if (shouldAutoAssign) {
      await tryAutoAssignThread(supabase, orgId, threadId!, now);
    }

    // ── 2) ALWAYS save inbound message (with thread_id) ──
    const { data: savedMsg } = await supabase.from("whatsapp_messages").insert({
      organization_id: orgId,
      instance_name: instanceName,
      thread_id: threadId,
      direction: "inbound",
      phone: normalizedPhone,
      message_text: text || "(mídia)",
      status: "delivered",
      external_message_id: msg.key?.id || null,
      metadata: { pushName, timestamp: msg.messageTimestamp },
    }).select("id").single();

    console.log(`[evolution-webhook] Message saved for phone ${normalizedPhone} thread=${threadId}`);

    // ── 3) Lead matching & engagement ──
    const phoneVariants = [
      normalizedPhone,
      normalizedPhone.startsWith("55") ? normalizedPhone.substring(2) : `55${normalizedPhone}`,
    ];

    let leadId: string | null = null;

    for (const variant of phoneVariants) {
      const { data: lead } = await supabase
        .from("leads")
        .select("id")
        .eq("organization_id", orgId)
        .or(`phone.eq.${variant},whatsapp.eq.${variant}`)
        .maybeSingle();

      if (lead) {
        leadId = lead.id;
        break;
      }
    }

    if (leadId) {
      if (savedMsg?.id) {
        await supabase
          .from("whatsapp_messages")
          .update({ lead_id: leadId })
          .eq("id", savedMsg.id);
      }

      await supabase
        .from("leads")
        .update({
          last_reply_at: now,
          last_inbound_message_at: now,
          last_inbound_message_text: text ? text.substring(0, 500) : "(mídia)",
          updated_at: now,
        })
        .eq("id", leadId);

      await wakePausedRuns(supabase, orgId, leadId, now);
      console.log(`[evolution-webhook] Inbound from ${normalizedPhone} linked to lead ${leadId}`);
    } else {
      // ── 4) Ad marker check for auto lead creation ──
      const hasAdMarker = containsAdMarker(text);

      if (hasAdMarker) {
        const { data: newLead } = await supabase
          .from("leads")
          .insert({
            organization_id: orgId,
            name: pushName || "Lead WhatsApp",
            phone: normalizedPhone,
            whatsapp: normalizedPhone,
            source: "Meta Ads",
            canal: "WhatsApp",
            status: "novo",
            last_reply_at: now,
            last_inbound_message_at: now,
            last_inbound_message_text: text ? text.substring(0, 500) : "(mídia)",
          })
          .select("id")
          .single();

        if (newLead && savedMsg?.id) {
          await supabase
            .from("whatsapp_messages")
            .update({ lead_id: newLead.id })
            .eq("id", savedMsg.id);
        }

        console.log(`[evolution-webhook] Ad lead auto-created for ${normalizedPhone}: ${newLead?.id}`);
      } else {
        console.log(`[evolution-webhook] No ad marker from ${normalizedPhone} — lead NOT created (thread=${threadId})`);
      }
    }
  }

  return respond({ ok: true });
}

// ── Auto-assign thread via round-robin ──────────────────
async function tryAutoAssignThread(
  supabase: any,
  orgId: string,
  threadId: string,
  now: string
) {
  try {
    // 1) Check if routing is enabled
    const { data: settings } = await supabase
      .from("whatsapp_routing_settings")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!settings || !settings.enabled) return;

    // 2) Check business hours if enabled
    if (settings.business_hours_enabled && settings.business_hours) {
      if (!isWithinBusinessHours(settings.business_hours)) {
        console.log("[evolution-webhook] Outside business hours — skipping auto-assign");
        return;
      }
    }

    // 3) Get eligible members based on only_roles
    const allowedRoles: string[] = settings.only_roles || ["seller", "admin"];

    const { data: eligibleMembers } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("organization_id", orgId)
      .in("role", allowedRoles);

    if (!eligibleMembers || eligibleMembers.length === 0) {
      console.log("[evolution-webhook] No eligible members for auto-assign");
      return;
    }

    // Get profile ids (user_id from user_roles -> profiles.user_id -> profiles.id)
    const userIds = eligibleMembers.map((m: any) => m.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id, name")
      .eq("organization_id", orgId)
      .in("user_id", userIds)
      .order("name", { ascending: true });

    if (!profiles || profiles.length === 0) {
      console.log("[evolution-webhook] No profiles found for eligible members");
      return;
    }

    // 4) Pick next assignee based on mode
    let nextProfile: any = null;
    const mode = settings.mode || "round_robin";

    if (mode === "least_loaded") {
      // Count open/pending threads per eligible profile
      const profileIds = profiles.map((p: any) => p.id);
      const { data: threads } = await supabase
        .from("whatsapp_threads")
        .select("assigned_user_id")
        .eq("organization_id", orgId)
        .in("assigned_user_id", profileIds)
        .in("status", ["open", "pending"]);

      const loadMap: Record<string, number> = {};
      for (const p of profiles) loadMap[p.id] = 0;
      if (threads) {
        for (const t of threads) {
          if (t.assigned_user_id && loadMap[t.assigned_user_id] !== undefined) {
            loadMap[t.assigned_user_id]++;
          }
        }
      }

      // Sort by load ascending, then by name for deterministic tiebreak
      const sorted = [...profiles].sort((a: any, b: any) => {
        const diff = (loadMap[a.id] || 0) - (loadMap[b.id] || 0);
        if (diff !== 0) return diff;
        return (a.name || "").localeCompare(b.name || "");
      });

      nextProfile = sorted[0];
      console.log(`[evolution-webhook] least_loaded picks ${nextProfile.name} (load=${loadMap[nextProfile.id]})`);
    } else {
      // round_robin (default)
      const { data: routingState } = await supabase
        .from("whatsapp_routing_state")
        .select("last_assigned_user_id")
        .eq("organization_id", orgId)
        .maybeSingle();

      const lastAssigned = routingState?.last_assigned_user_id || null;
      nextProfile = profiles[0];

      if (lastAssigned) {
        const lastIndex = profiles.findIndex((p: any) => p.id === lastAssigned);
        if (lastIndex >= 0 && lastIndex < profiles.length - 1) {
          nextProfile = profiles[lastIndex + 1];
        }
      }
    }

    // 5) Assign the thread
    await supabase
      .from("whatsapp_threads")
      .update({
        assigned_user_id: nextProfile.id,
        assigned_at: now,
      })
      .eq("id", threadId);

    // 6) Update routing state (used by round-robin, but kept in sync for both)
    await supabase
      .from("whatsapp_routing_state")
      .upsert({
        organization_id: orgId,
        last_assigned_user_id: nextProfile.id,
        updated_at: now,
      }, { onConflict: "organization_id" });

    console.log(`[evolution-webhook] Auto-assigned thread ${threadId} to ${nextProfile.name} (${nextProfile.id}) via ${mode}`);
  } catch (err) {
    console.error("[evolution-webhook] Error in auto-assign:", err);
  }
}

// ── Helper: Check business hours ──────────────────────────
function isWithinBusinessHours(bh: any): boolean {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
    const days: number[] = bh.days || [1, 2, 3, 4, 5];

    if (!days.includes(dayOfWeek)) return false;

    const [startH, startM] = (bh.start || "08:00").split(":").map(Number);
    const [endH, endM] = (bh.end || "18:00").split(":").map(Number);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } catch {
    return true; // fail-open
  }
}

// ── Helper: Check ad marker ──────────────────────────────
function containsAdMarker(text: string): boolean {
  if (!text) return false;
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalized.includes("anuncio");
}

// ── Helper: respond ──────────────────────────────────────
function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
    },
  });
}

// ── Helper: Wake paused automation runs ──────────────────

async function wakePausedRuns(
  supabase: any,
  orgId: string,
  leadId: string,
  replyTimestamp: string
) {
  try {
    const { data: waitJobs } = await supabase
      .from("automation_jobs")
      .select("id, run_id, automation_id, node_id, organization_id, payload")
      .eq("organization_id", orgId)
      .eq("job_type", "wait_for_reply_timeout")
      .eq("status", "pending")
      .filter("payload->>lead_id", "eq", leadId);

    if (!waitJobs || waitJobs.length === 0) return;

    console.log(`[evolution-webhook] Waking ${waitJobs.length} paused run(s) for lead ${leadId}`);

    for (const job of waitJobs) {
      await supabase
        .from("automation_jobs")
        .update({ status: "done", last_error: null })
        .eq("id", job.id);

      const { data: flow } = await supabase
        .from("automation_flows")
        .select("nodes, edges")
        .eq("automation_id", job.automation_id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!flow) continue;

      const nodes: any[] = flow.nodes || [];
      const edges: any[] = flow.edges || [];

      const repliedEdge = edges.find(
        (e: any) => e.source === job.node_id && e.sourceHandle === "replied"
      );

      await supabase
        .from("automation_runs")
        .update({ status: "running" })
        .eq("id", job.run_id);

      if (repliedEdge) {
        const nextNode = nodes.find((n: any) => n.id === repliedEdge.target);
        if (nextNode) {
          await supabase.from("automation_jobs").insert({
            organization_id: orgId,
            automation_id: job.automation_id,
            run_id: job.run_id,
            node_id: nextNode.id,
            job_type: nextNode.type || "action",
            payload: {
              node_config: nextNode.data?.config || {},
              node_label: nextNode.data?.label || "",
            },
            scheduled_for: new Date().toISOString(),
            status: "pending",
            attempts: 0,
          });
        }
      }

      await supabase.from("automation_logs").insert({
        organization_id: orgId,
        automation_id: job.automation_id,
        run_id: job.run_id,
        node_id: job.node_id,
        level: "info",
        message: "Resposta recebida — run retomada pelo caminho 'Respondeu'",
        data: { lead_id: leadId, reply_at: replyTimestamp },
      });
    }
  } catch (err) {
    console.error("[evolution-webhook] Error waking paused runs:", err);
  }
}
