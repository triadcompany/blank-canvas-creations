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
        console.warn("[evolution-webhook] Invalid webhook secret. Token param:", tokenParam ? "present" : "missing", "Header:", tokenHeader ? "present" : "missing");
        console.warn("[evolution-webhook] HINT: Reconnect WhatsApp to fix the webhook URL with the correct token.");
        // Log the rejected event for debugging
        try {
          const bodyText = await req.text();
          const bodyPreview = bodyText.substring(0, 200);
          console.warn("[evolution-webhook] Rejected payload preview:", bodyPreview);
        } catch { /* ignore */ }
        return respond({ ok: false, error: "unauthorized" }, 401);
      }
    }

    const body = await req.json();
    console.log("[evolution-webhook] Event received:", JSON.stringify(body).substring(0, 500));

    const event = body.event || body.action;
    const instanceName = body.instance || body.instanceName;

    // Extract remoteJid for logging
    const msgData = body.data || {};
    const msgArray = Array.isArray(msgData) ? msgData : [msgData];
    const firstMsg = msgArray[0] || {};
    const remoteJid = firstMsg?.key?.remoteJid || firstMsg?.remoteJid || null;

    // Find integration by instance name
    const { data: integration } = await supabase
      .from("whatsapp_integrations")
      .select("id, organization_id, status")
      .eq("instance_name", instanceName)
      .maybeSingle();

    if (!integration) {
      console.log("[evolution-webhook] Unknown instance:", instanceName);
      // Log unlinked event
      await logWebhookEvent(supabase, {
        instance_name: instanceName,
        event_type: event,
        remote_jid: remoteJid,
        detected_organization_id: null,
        processing_result: "unknown_instance",
        error_message: `No whatsapp_integration found for instance: ${instanceName}`,
        payload: { event, instanceName, remoteJid },
      });
      return respond({ ok: true, message: "unknown instance" });
    }

    const orgId = integration.organization_id;

    // Log every event for debugging
    await logWebhookEvent(supabase, {
      instance_name: instanceName,
      event_type: event,
      remote_jid: remoteJid,
      detected_organization_id: orgId,
      processing_result: "processing",
      payload: { event, instanceName, remoteJid, hasData: !!body.data },
    });

    // ── CONNECTION UPDATE ──
    if (event === "CONNECTION_UPDATE" || event === "connection.update") {
      return await handleConnectionUpdate(supabase, body, integration);
    }

    // ── QR CODE UPDATE ──
    if (event === "QRCODE_UPDATED" || event === "qrcode.updated") {
      return await handleQrCodeUpdate(supabase, body, integration);
    }

    // ── MESSAGES (inbound + outbound) ──
    if (event === "MESSAGES_UPSERT" || event === "messages.upsert") {
      return await handleMessages(supabase, body, orgId, instanceName);
    }

    // ── MESSAGE STATUS UPDATES ──
    if (event === "MESSAGES_UPDATE" || event === "messages.update") {
      return await handleMessageStatusUpdate(supabase, body, orgId);
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

// ── MESSAGE STATUS UPDATE handler (delivered/read) ──
async function handleMessageStatusUpdate(supabase: any, body: any, orgId: string) {
  console.log("[evolution-webhook] Message status update received");
  return respond({ ok: true });
}

// ── MESSAGES handler (inbound + outbound) ──
async function handleMessages(supabase: any, body: any, orgId: string, instanceName: string) {
  const messages = body.data || [];
  const msgArray = Array.isArray(messages) ? messages : [messages];

  for (const msg of msgArray) {
    const isFromMe = msg.key?.fromMe === true;

    // Extract phone from remoteJid
    const phone = (msg.key?.remoteJid || "")
      .replace("@s.whatsapp.net", "")
      .replace("@c.us", "");

    if (!phone) continue;

    // Extract text
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text || null;

    // For non-text: create a placeholder
    const mediaType = msg.message?.imageMessage ? "imagem"
      : msg.message?.videoMessage ? "vídeo"
      : msg.message?.audioMessage ? "áudio"
      : msg.message?.documentMessage ? "documento"
      : msg.message?.stickerMessage ? "sticker"
      : null;

    const displayBody = text || (mediaType ? `📎 (${mediaType})` : null);

    // Skip if no content at all
    if (!displayBody) {
      console.log(`[evolution-webhook] Empty message from ${phone} — ignored`);
      continue;
    }

    const normalizedPhone = phone.replace(/[\s\-\+\(\)]/g, "");
    const now = new Date().toISOString();
    // Extract contact name from multiple possible fields
    const pushName = msg.pushName || msg.notifyName || msg.senderName || msg.profileName || "";
    const messagePreview = displayBody.substring(0, 100);
    const externalMessageId = msg.key?.id || null;
    const direction = isFromMe ? "outbound" : "inbound";

    // ── 1) UPSERT into conversations table ──
    let conversationId: string | null = null;

    const { data: existingConv } = await supabase
      .from("conversations")
      .select("id, unread_count, contact_name, contact_name_source, profile_picture_url, profile_picture_updated_at")
      .eq("organization_id", orgId)
      .eq("instance_name", instanceName)
      .eq("contact_phone", normalizedPhone)
      .maybeSingle();

    const convUpdate: Record<string, unknown> = {
      last_message_at: now,
      last_message_preview: messagePreview,
    };

    if (existingConv) {
      conversationId = existingConv.id;
      // Only increment unread for inbound
      if (!isFromMe) {
        convUpdate.unread_count = (existingConv.unread_count || 0) + 1;
      }
      // Update contact_name from WhatsApp if:
      // - we have a pushName AND
      // - name is empty, equals the phone, or was previously set by whatsapp (not manually edited)
      if (pushName && pushName !== normalizedPhone) {
        const currentName = existingConv.contact_name || "";
        const nameSource = existingConv.contact_name_source || "whatsapp";
        const nameIsPhoneOrEmpty = !currentName || currentName === normalizedPhone || currentName === phone;
        if (nameIsPhoneOrEmpty || nameSource === "whatsapp") {
          convUpdate.contact_name = pushName;
          convUpdate.contact_name_source = "whatsapp";
        }
      }
      await supabase
        .from("conversations")
        .update(convUpdate)
        .eq("id", conversationId);

      // Fetch profile picture with 24h cache
      if (!isFromMe) {
        const picUpdatedAt = existingConv.profile_picture_updated_at;
        const needsRefresh = !existingConv.profile_picture_url || 
          !picUpdatedAt || 
          (Date.now() - new Date(picUpdatedAt).getTime()) > 24 * 60 * 60 * 1000;
        if (needsRefresh) {
          fetchAndSaveProfilePicture(supabase, instanceName, normalizedPhone, conversationId);
        }
      }
    } else {
      const { data: newConv } = await supabase
        .from("conversations")
        .insert({
          organization_id: orgId,
          instance_name: instanceName,
          contact_phone: normalizedPhone,
          contact_name: pushName || null,
          contact_name_source: pushName ? "whatsapp" : null,
          last_message_at: now,
          last_message_preview: messagePreview,
          unread_count: isFromMe ? 0 : 1,
          assigned_to: null,
        })
        .select("id")
        .single();

      conversationId = newConv?.id || null;
      console.log(`[evolution-webhook] Conversation created for ${normalizedPhone}: ${conversationId}`);

      // Fetch profile picture for new conversation
      if (conversationId && !isFromMe) {
        fetchAndSaveProfilePicture(supabase, instanceName, normalizedPhone, conversationId);
      }
    }

    // ── 2) Save message to messages table (idempotent by external ID) ──
    if (conversationId && externalMessageId) {
      const { data: existingMsg } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("external_message_id", externalMessageId)
        .maybeSingle();

      if (!existingMsg) {
        await supabase.from("messages").insert({
          organization_id: orgId,
          conversation_id: conversationId,
          direction,
          body: displayBody,
          external_message_id: externalMessageId,
        });
      }
    } else if (conversationId) {
      await supabase.from("messages").insert({
        organization_id: orgId,
        conversation_id: conversationId,
        direction,
        body: displayBody,
      });
    }

    // ── 3) Legacy whatsapp_threads / whatsapp_messages (inbound only) ──
    if (!isFromMe) {
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
            routing_bucket: containsAdMarker(text || "") ? "traffic" : "non_traffic",
            first_message_text: (text || "").substring(0, 500),
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
        message_text: text || displayBody,
        status: "delivered",
        external_message_id: externalMessageId,
        metadata: { pushName, timestamp: msg.messageTimestamp },
      });

      console.log(`[evolution-webhook] Inbound message saved: phone=${normalizedPhone} conv=${conversationId} thread=${threadId}`);

      // ── 4) Lead matching & engagement (inbound only) ──
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
            last_inbound_message_text: (text || "").substring(0, 500),
            updated_at: now,
          })
          .eq("id", leadId);

        await wakePausedRuns(supabase, orgId, leadId, now);
        console.log(`[evolution-webhook] Linked to lead ${leadId}`);
      } else if (containsAdMarker(text || "")) {
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
            last_inbound_message_text: (text || "").substring(0, 500),
          });

        console.log(`[evolution-webhook] Ad lead auto-created for ${normalizedPhone}`);
      }
    } else {
      console.log(`[evolution-webhook] Outbound message saved: phone=${normalizedPhone} conv=${conversationId}`);
    }
  }

  // After processing all messages, invoke the worker
  await invokeWorker();

  return respond({ ok: true });
}

// ── Helper: Fetch profile picture from Evolution API ──
async function fetchAndSaveProfilePicture(
  supabase: any,
  instanceName: string,
  phone: string,
  conversationId: string
) {
  try {
    const evolutionBaseUrl = Deno.env.get("EVOLUTION_BASE_URL");
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");

    if (!evolutionBaseUrl || !evolutionApiKey) return;

    const res = await fetch(
      `${evolutionBaseUrl}/chat/fetchProfilePictureUrl/${instanceName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: evolutionApiKey,
        },
        body: JSON.stringify({ number: phone }),
      }
    );

    if (!res.ok) {
      console.log(`[evolution-webhook] Profile picture fetch failed for ${phone}: ${res.status}`);
      return;
    }

    const data = await res.json();
    const pictureUrl = data?.profilePictureUrl || data?.pictureUrl || data?.imgUrl || null;

    const updateData: Record<string, unknown> = {
      profile_picture_updated_at: new Date().toISOString(),
    };
    if (pictureUrl) {
      updateData.profile_picture_url = pictureUrl;
    }
    await supabase
      .from("conversations")
      .update(updateData)
      .eq("id", conversationId);

    if (pictureUrl) {
      console.log(`[evolution-webhook] Profile picture saved for ${phone}`);
    } else {
      console.log(`[evolution-webhook] No profile picture available for ${phone}, timestamp updated`);
    }
  } catch (err) {
    // Non-critical — don't fail the webhook
    console.log(`[evolution-webhook] Profile picture fetch error for ${phone}:`, err);
  }
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

// ── Helper: Log webhook event for debugging ──
async function logWebhookEvent(supabase: any, data: {
  instance_name?: string;
  event_type?: string;
  remote_jid?: string;
  detected_organization_id?: string | null;
  processing_result?: string;
  error_message?: string;
  payload?: any;
}) {
  try {
    await supabase.from("evolution_webhook_logs").insert({
      instance_name: data.instance_name || null,
      event_type: data.event_type || null,
      remote_jid: data.remote_jid || null,
      detected_organization_id: data.detected_organization_id || null,
      processing_result: data.processing_result || null,
      error_message: data.error_message || null,
      payload: data.payload || null,
    });
  } catch (err) {
    console.error("[evolution-webhook] Failed to log webhook event:", err);
  }
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
