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
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
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
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle connection updates
    if (event === "CONNECTION_UPDATE" || event === "connection.update") {
      const state = body.data?.state || body.state;
      let newStatus = "disconnected";
      if (state === "open") newStatus = "connected";
      else if (state === "connecting") newStatus = "qr_pending";
      else if (state === "close") newStatus = "disconnected";

      await supabase
        .from("whatsapp_integrations")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", integration.id);

      console.log(`[evolution-webhook] Connection updated: ${newStatus}`);
      return new Response(JSON.stringify({ ok: true, status: newStatus }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle inbound messages
    if (event === "MESSAGES_UPSERT" || event === "messages.upsert") {
      const messages = body.data || [];
      const msgArray = Array.isArray(messages) ? messages : [messages];

      for (const msg of msgArray) {
        // Skip outbound messages
        if (msg.key?.fromMe) continue;

        const phone = (msg.key?.remoteJid || "").replace("@s.whatsapp.net", "").replace("@c.us", "");
        const text = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text ||
                     msg.message?.imageMessage?.caption ||
                     "";
        const pushName = msg.pushName || "";

        if (!phone || !text) continue;

        // Log inbound message
        await supabase.from("whatsapp_messages").insert({
          organization_id: integration.organization_id,
          direction: "inbound",
          phone,
          message_text: text,
          status: "delivered",
          external_message_id: msg.key?.id || null,
          metadata: { pushName, timestamp: msg.messageTimestamp },
        });

        // Find lead by phone and update last_reply
        const { data: lead } = await supabase
          .from("leads")
          .select("id")
          .eq("organization_id", integration.organization_id)
          .eq("phone", phone)
          .maybeSingle();

        if (lead) {
          // Update whatsapp_messages with lead_id
          if (msg.key?.id) {
            await supabase
              .from("whatsapp_messages")
              .update({ lead_id: lead.id })
              .eq("external_message_id", msg.key.id);
          }

          // Check for automation runs waiting for reply (condition node: "replied")
          const { data: waitingRuns } = await supabase
            .from("automation_runs")
            .select("id")
            .eq("organization_id", integration.organization_id)
            .eq("lead_id", lead.id)
            .eq("status", "waiting");

          // Future: trigger condition evaluation for "replied" condition nodes
        }

        console.log(`[evolution-webhook] Inbound from ${phone}: ${text.substring(0, 50)}`);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[evolution-webhook] Error:", err);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
