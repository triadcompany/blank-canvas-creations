import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION = "meta-webhook@2026-02-11.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // ── GET: Meta webhook verification handshake ──
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const verifyToken = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") || "autolead_instagram_verify";

    // Health check
    if (!mode && !token && !challenge) {
      return new Response(
        JSON.stringify({ ok: true, name: "meta-webhook", version: VERSION }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[META_WEBHOOK_GET] mode=${mode} token_match=${token === verifyToken}`);

    if (mode === "subscribe" && token === verifyToken) {
      return new Response(challenge, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain" },
      });
    }

    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  // ── POST: Receive events from Meta ──
  if (req.method === "POST") {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response("Bad Request", { status: 400, headers: corsHeaders });
    }

    console.log(`[META_WEBHOOK_POST] object=${body.object} entries=${body.entry?.length || 0}`);

    // Log raw event
    const pageId = body.entry?.[0]?.id || null;

    // Lookup org
    let organizationId: string | null = null;
    if (pageId) {
      const { data: si } = await supabase
        .from("social_integrations")
        .select("organization_id")
        .eq("page_id", pageId)
        .eq("status", "active")
        .maybeSingle();
      organizationId = si?.organization_id || null;
    }

    // Save webhook log
    await supabase.from("social_webhook_logs").insert({
      organization_id: organizationId,
      platform: "instagram",
      page_id: pageId,
      event_type: body.object || "unknown",
      payload: body,
      auth_status: organizationId ? "ok" : "unknown_page",
    });

    // Process Instagram messaging events
    if (body.object === "instagram" || body.object === "page") {
      for (const entry of body.entry || []) {
        const messaging = entry.messaging || [];
        for (const event of messaging) {
          const senderId = event.sender?.id;
          const recipientId = event.recipient?.id;
          const message = event.message;
          const timestamp = event.timestamp;

          if (!senderId || !recipientId || !message) continue;
          if (!organizationId) {
            console.log(`[META_WEBHOOK_POST] No org for page ${recipientId}, skipping message`);
            continue;
          }

          // Find or create conversation
          const contactPhone = `ig:${senderId}`;
          let { data: conversation } = await supabase
            .from("conversations")
            .select("*")
            .eq("organization_id", organizationId)
            .eq("contact_phone", contactPhone)
            .eq("channel", "instagram")
            .maybeSingle();

          if (!conversation) {
            // Try to get sender name from message
            const contactName = event.sender?.name || `Instagram ${senderId.slice(-4)}`;

            const { data: newConv } = await supabase
              .from("conversations")
              .insert({
                organization_id: organizationId,
                contact_phone: contactPhone,
                contact_name: contactName,
                channel: "instagram",
                instance_name: `ig_${recipientId}`,
                last_message_at: new Date(timestamp * 1000).toISOString(),
                last_message_preview: (message.text || "[Mídia]").substring(0, 100),
                unread_count: 1,
              })
              .select()
              .single();

            conversation = newConv;
          }

          if (!conversation) continue;

          // Save message
          const msgBody = message.text || "[Mídia]";
          const mediaUrl = message.attachments?.[0]?.payload?.url || null;
          const msgType = message.attachments?.[0]?.type || "text";

          await supabase.from("messages").insert({
            organization_id: organizationId,
            conversation_id: conversation.id,
            direction: "inbound",
            body: msgBody,
            channel: "instagram",
            external_message_id: message.mid || null,
            media_url: mediaUrl,
            media_type: msgType !== "text" ? msgType : null,
          });

          // Update conversation
          await supabase
            .from("conversations")
            .update({
              last_message_at: new Date(timestamp * 1000).toISOString(),
              last_message_preview: msgBody.substring(0, 100),
              unread_count: (conversation.unread_count || 0) + 1,
            })
            .eq("id", conversation.id);

          console.log(`[META_WEBHOOK_POST] Saved message from ${senderId} in conv ${conversation.id}`);
        }
      }
    }

    return new Response("EVENT_RECEIVED", { status: 200, headers: corsHeaders });
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});
