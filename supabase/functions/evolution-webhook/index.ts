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

    // ── QR CODE UPDATE ──
    if (event === "QRCODE_UPDATED" || event === "qrcode.updated") {
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

    // ── INBOUND MESSAGES ──
    if (event === "MESSAGES_UPSERT" || event === "messages.upsert") {
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

        const { data: existingThread } = await supabase
          .from("whatsapp_threads")
          .select("id, contact_name")
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
          // Update contact_name if we have pushName and thread doesn't have one yet
          if (pushName && !existingThread.contact_name) {
            threadUpdate.contact_name = pushName;
          }
          // Re-open thread if it was closed
          threadUpdate.status = "open";

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
              assigned_user_id: null,
              last_message_at: now,
              last_message_preview: messagePreview,
            })
            .select("id")
            .single();

          threadId = newThread?.id || null;
          console.log(`[evolution-webhook] Thread created for ${normalizedPhone}: ${threadId}`);
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
          // ── 4) Ad marker check for auto lead creation (separate from Inbox) ──
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

    return respond({ ok: true });
  } catch (err) {
    console.error("[evolution-webhook] Error:", err);
    return respond({ ok: true });
  }
});

// ── Helper: Check ad marker ──────────────────────────────

function containsAdMarker(text: string): boolean {
  if (!text) return false;
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalized.includes("anuncio");
}

// ── Helper: Wake paused automation runs ──────────────────

async function wakePausedRuns(
  supabase: any,
  orgId: string,
  leadId: string,
  replyTimestamp: string
) {
  try {
    // Find pending wait_for_reply_timeout jobs for this lead
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
      // 1) Mark the timeout job as done (replied)
      await supabase
        .from("automation_jobs")
        .update({ status: "done", last_error: null })
        .eq("id", job.id);

      // 2) Load the flow to find the "replied" edge
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

      // Find the "replied" edge from this node
      const repliedEdge = edges.find(
        (e: any) => e.source === job.node_id && e.sourceHandle === "replied"
      );

      // 3) Resume the run
      await supabase
        .from("automation_runs")
        .update({ status: "running" })
        .eq("id", job.run_id);

      // 4) Schedule the next node if replied edge exists
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

      // 5) Log
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
