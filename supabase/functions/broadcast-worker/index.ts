import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");
    const evolutionBaseUrl = Deno.env.get("EVOLUTION_BASE_URL");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (!evolutionApiKey || !evolutionBaseUrl) {
      return respond({ error: "EVOLUTION_API_KEY ou EVOLUTION_BASE_URL não configurados" }, 500);
    }

    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return respond({ error: "campaign_id é obrigatório" }, 400);
    }

    // Get campaign
    const { data: campaign, error: cErr } = await supabase
      .from("broadcast_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .single();

    if (cErr || !campaign) {
      return respond({ error: "Campanha não encontrada" }, 404);
    }

    const settings = campaign.settings as Record<string, any>;
    const minDelay = settings.minDelay || 20;
    const maxDelay = settings.maxDelay || 60;
    const limitPerHour = settings.limitPerHour || 80;
    const windowStart = settings.windowStart || "09:00";
    const windowEnd = settings.windowEnd || "18:00";

    let sentThisHour = 0;
    let hourStart = Date.now();

    // Process loop
    let hasMore = true;
    while (hasMore) {
      // Re-check campaign status
      const { data: freshCampaign } = await supabase
        .from("broadcast_campaigns")
        .select("status")
        .eq("id", campaign_id)
        .single();

      if (!freshCampaign || freshCampaign.status !== "running") {
        console.log(`[broadcast-worker] Campaign ${campaign_id} is no longer running (${freshCampaign?.status})`);
        break;
      }

      // Check time window
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      if (currentTime < windowStart || currentTime > windowEnd) {
        console.log(`[broadcast-worker] Outside send window (${currentTime}), stopping`);
        break;
      }

      // Rate limit check
      if (Date.now() - hourStart > 3600000) {
        sentThisHour = 0;
        hourStart = Date.now();
      }
      if (sentThisHour >= limitPerHour) {
        console.log(`[broadcast-worker] Rate limit reached (${limitPerHour}/h), stopping`);
        break;
      }

      // Get next batch of pending recipients
      const { data: recipients, error: rErr } = await supabase
        .from("broadcast_recipients")
        .select("*")
        .eq("campaign_id", campaign_id)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(10);

      if (rErr) {
        console.error("[broadcast-worker] Error fetching recipients:", rErr);
        break;
      }

      if (!recipients || recipients.length === 0) {
        hasMore = false;
        // Mark campaign as completed
        await supabase
          .from("broadcast_campaigns")
          .update({ status: "completed" })
          .eq("id", campaign_id);
        console.log(`[broadcast-worker] Campaign ${campaign_id} completed`);
        break;
      }

      for (const recipient of recipients) {
        // Re-check rate limit
        if (sentThisHour >= limitPerHour) break;

        // Set sending
        await supabase
          .from("broadcast_recipients")
          .update({ status: "sending" })
          .eq("id", recipient.id);

        try {
          const phone = recipient.phone.replace(/\D/g, "");
          const payload = campaign.payload as Record<string, any>;
          const payloadType = campaign.payload_type;

          let sendUrl: string;
          let sendBody: Record<string, any>;

          if (payloadType === "text") {
            // Render template
            let text = payload.text || "";
            const vars = (recipient.variables || {}) as Record<string, any>;
            text = text.replace(/\{\{nome\}\}/gi, recipient.name || "");
            for (const [key, val] of Object.entries(vars)) {
              text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), String(val || ""));
            }

            sendUrl = `${evolutionBaseUrl}/message/sendText/${campaign.instance_name}`;
            sendBody = { number: phone, text };
          } else if (payloadType === "image") {
            sendUrl = `${evolutionBaseUrl}/message/sendMedia/${campaign.instance_name}`;
            sendBody = {
              number: phone,
              mediatype: "image",
              media: payload.media_url,
              caption: payload.caption || "",
            };
          } else {
            // audio
            sendUrl = `${evolutionBaseUrl}/message/sendMedia/${campaign.instance_name}`;
            sendBody = {
              number: phone,
              mediatype: "audio",
              media: payload.media_url,
            };
          }

          const res = await fetch(sendUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: evolutionApiKey,
            },
            body: JSON.stringify(sendBody),
          });

          const resData = await res.json();

          if (!res.ok) {
            await supabase
              .from("broadcast_recipients")
              .update({
                status: "failed",
                error: JSON.stringify(resData).substring(0, 500),
              })
              .eq("id", recipient.id);
            console.error(`[broadcast-worker] Failed for ${phone}:`, resData);
          } else {
            const messageId = resData?.key?.id || resData?.messageId || null;
            await supabase
              .from("broadcast_recipients")
              .update({
                status: "sent",
                sent_at: new Date().toISOString(),
                message_id: messageId,
              })
              .eq("id", recipient.id);
            sentThisHour++;

            // NOTE: Automation is triggered on RESPONSE (via evolution-webhook),
            // not on send. This avoids creating leads for non-responsive recipients.
          }
        } catch (err) {
          await supabase
            .from("broadcast_recipients")
            .update({
              status: "failed",
              error: String(err).substring(0, 500),
            })
            .eq("id", recipient.id);
          console.error(`[broadcast-worker] Error:`, err);
        }

        // Random delay
        const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
      }
    }

    return respond({ ok: true, campaign_id });
  } catch (err) {
    console.error("[broadcast-worker] Error:", err);
    return respond({ error: String(err) }, 500);
  }
});
