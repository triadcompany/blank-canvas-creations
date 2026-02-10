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
    // Optional webhook secret validation
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

    // Ignore all other events
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
    // Skip outgoing messages
    if (msg.key?.fromMe) continue;

    // Extract phone from remoteJid
    const phone = (msg.key?.remoteJid || "")
      .replace("@s.whatsapp.net", "")
      .replace("@c.us", "");

    // Extract text — only process text messages
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text || null;

    // Ignore non-text messages
    if (!text) {
      console.log(`[evolution-webhook] Non-text message from ${phone} — ignored`);
      continue;
    }

    if (!phone) continue;

    const normalizedPhone = phone.replace(/[\s\-\+\(\)]/g, "");
    const now = new Date().toISOString();
    const pushName = msg.pushName || "";
    const messagePreview = text.substring(0, 100);
    const externalMessageId = msg.key?.id || null;

    // ── 1) UPSERT into conversations table (Inbox source) ──
    let conversationId: string | null = null;

    const { data: existingConv } = await supabase
      .from("conversations")
      .select("id, unread_count")
      .eq("organization_id", orgId)
      .eq("instance_name", instanceName)
      .eq("contact_phone", normalizedPhone)
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
      await supabase
        .from("conversations")
        .update({
          last_message_at: now,
          unread_count: (existingConv.unread_count || 0) + 1,
        })
        .eq("id", conversationId);
    } else {
      const { data: newConv } = await supabase
        .from("conversations")
        .insert({
          organization_id: orgId,
          instance_name: instanceName,
          contact_phone: normalizedPhone,
          last_message_at: now,
          unread_count: 1,
          assigned_to: null,
        })
        .select("id")
        .single();

      conversationId = newConv?.id || null;
      console.log(`[evolution-webhook] Conversation created for ${normalizedPhone}: ${conversationId}`);
    }

    // ── 2) Save inbound message to messages table (Inbox source) ──
    if (conversationId) {
      // Idempotency: skip if externalMessageId already exists
      if (externalMessageId) {
        const { data: existingMsg } = await supabase
          .from("messages")
          .select("id")
          .eq("conversation_id", conversationId)
          .eq("body", text)
          .eq("direction", "inbound")
          .limit(1)
          .maybeSingle();

        if (!existingMsg) {
          await supabase.from("messages").insert({
            organization_id: orgId,
            conversation_id: conversationId,
            direction: "inbound",
            body: text,
          });
        }
      } else {
        await supabase.from("messages").insert({
          organization_id: orgId,
          conversation_id: conversationId,
          direction: "inbound",
          body: text,
        });
      }
    }

    // ── 3) Also persist to legacy whatsapp_threads / whatsapp_messages ──
    let threadId: string | null = null;

    const { data: existingThread } = await supabase
      .from("whatsapp_threads")
      .select("id, contact_name, unread_count")
      .eq("organization_id", orgId)
      .eq("contact_phone_e164", normalizedPhone)
      .maybeSingle();

    if (existingThread) {
      threadId = existingThread.id;
      const threadUpdate: Record<string, unknown> = {
        last_message_at: now,
        last_message_preview: messagePreview,
        instance_name: instanceName,
        status: "open",
        unread_count: (existingThread.unread_count || 0) + 1,
      };
      if (pushName && !existingThread.contact_name) {
        threadUpdate.contact_name = pushName;
      }

      await supabase
        .from("whatsapp_threads")
        .update(threadUpdate)
        .eq("id", threadId);
    } else {
      const { data: newThread } = await supabase
        .from("whatsapp_threads")
        .insert({
          organization_id: orgId,
          instance_name: instanceName,
          contact_phone_e164: normalizedPhone,
          contact_name: pushName || null,
          status: "open",
          last_message_at: now,
          last_message_preview: messagePreview,
          unread_count: 1,
          routing_bucket: containsAdMarker(text) ? "traffic" : "non_traffic",
          first_message_text: text.substring(0, 500),
          first_message_at: now,
        })
        .select("id")
        .single();

      threadId = newThread?.id || null;
      console.log(`[evolution-webhook] Thread created for ${normalizedPhone}: ${threadId}`);
    }

    // Save to legacy whatsapp_messages
    await supabase.from("whatsapp_messages").insert({
      organization_id: orgId,
      instance_name: instanceName,
      thread_id: threadId,
      direction: "inbound",
      phone: normalizedPhone,
      message_text: text,
      status: "delivered",
      external_message_id: externalMessageId,
      metadata: { pushName, timestamp: msg.messageTimestamp },
    });

    console.log(`[evolution-webhook] Inbound message saved: phone=${normalizedPhone} conv=${conversationId} thread=${threadId}`);

    // ── 4) Lead matching & engagement ──
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
      await supabase
        .from("leads")
        .update({
          last_reply_at: now,
          last_inbound_message_at: now,
          last_inbound_message_text: text.substring(0, 500),
          updated_at: now,
        })
        .eq("id", leadId);

      await wakePausedRuns(supabase, orgId, leadId, now);
      console.log(`[evolution-webhook] Linked to lead ${leadId}`);
    } else if (containsAdMarker(text)) {
      // Auto-create lead from ad traffic
      await supabase
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
          last_inbound_message_text: text.substring(0, 500),
        });

      console.log(`[evolution-webhook] Ad lead auto-created for ${normalizedPhone}`);
    }
  }

  // After processing all inbound messages, invoke the worker
  // to pick up any jobs created by wakePausedRuns
  await invokeWorker();

  return respond({ ok: true });
}

// ── Helper: Check ad marker ──
function containsAdMarker(text: string): boolean {
  if (!text) return false;
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalized.includes("anuncio");
}

// ── Helper: respond ──
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

// ── Helper: Wake paused automation runs ──
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

    // Auto-invoke worker to process the newly created jobs
    if (waitJobs.length > 0) {
      await invokeWorker();
    }
  } catch (err) {
    console.error("[evolution-webhook] Error waking paused runs:", err);
  }
}

// ── Helper: Invoke automation-worker ──
async function invokeWorker() {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const res = await fetch(`${supabaseUrl}/functions/v1/automation-worker`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    console.log(`[evolution-webhook] Worker invoked: processed=${data.processed}, failed=${data.failed}`);
  } catch (err) {
    console.error("[evolution-webhook] Failed to invoke worker:", err);
  }
}
