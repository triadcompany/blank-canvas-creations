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

// Schedules the next invocation after `delaySecs` using EdgeRuntime.waitUntil
// so the current request can return immediately without blocking.
function scheduleNext(
  supabaseUrl: string,
  serviceKey: string,
  campaignId: string,
  delaySecs: number,
) {
  const invoke = async () => {
    await new Promise((r) => setTimeout(r, delaySecs * 1000));
    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/broadcast-worker`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
          body: JSON.stringify({ campaign_id: campaignId }),
        },
      );
      if (!res.ok) {
        console.error(
          `[broadcast-worker] Re-invoke failed (${res.status}):`,
          await res.text(),
        );
      }
    } catch (err) {
      console.error("[broadcast-worker] Re-invoke error:", err);
    }
  };

  // deno-lint-ignore no-explicit-any
  if (typeof (globalThis as any).EdgeRuntime !== "undefined") {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime.waitUntil(invoke());
  } else {
    invoke().catch(console.error);
  }
}

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
      return respond(
        { error: "EVOLUTION_API_KEY ou EVOLUTION_BASE_URL não configurados" },
        500,
      );
    }

    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return respond({ error: "campaign_id é obrigatório" }, 400);
    }

    // Get fresh campaign state on every invocation
    const { data: campaign, error: cErr } = await supabase
      .from("broadcast_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .single();

    if (cErr || !campaign) {
      return respond({ error: "Campanha não encontrada" }, 404);
    }

    if (campaign.status !== "running") {
      console.log(
        `[broadcast-worker] Campaign ${campaign_id} not running (${campaign.status}), stopping`,
      );
      return respond({ ok: true, skipped: true, reason: campaign.status });
    }

    const settings = campaign.settings as Record<string, any>;
    const minDelay = settings.minDelay || 5;
    const maxDelay = settings.maxDelay || 15;
    const limitPerHour = settings.limitPerHour || 80;

    // windowStart / windowEnd are OPTIONAL — no default restriction.
    // Bug fix: the old code defaulted to "09:00"/"18:00" UTC, which blocked
    // Brazilian users (UTC-3) creating campaigns after 15:00 local time.
    const windowStart: string | undefined = settings.windowStart;
    const windowEnd: string | undefined = settings.windowEnd;

    // Check time window only when explicitly configured.
    // Use UTC offset from settings (default -3 for Brazil).
    if (windowStart && windowEnd) {
      const utcOffset: number = settings.utcOffset ?? -3;
      const nowUtc = new Date();
      const localHours = (nowUtc.getUTCHours() + utcOffset + 24) % 24;
      const localMinutes = nowUtc.getUTCMinutes();
      const currentTime = `${String(localHours).padStart(2, "0")}:${String(localMinutes).padStart(2, "0")}`;

      if (currentTime < windowStart || currentTime >= windowEnd) {
        console.log(
          `[broadcast-worker] Outside send window (${currentTime}), re-scheduling in 15min`,
        );
        scheduleNext(supabaseUrl, supabaseServiceKey, campaign_id, 15 * 60);
        return respond({ ok: true, outside_window: true, current_time: currentTime });
      }
    }

    // Rate limit: count messages sent in the last hour from the DB
    // (in-memory counter was lost between invocations in the old architecture).
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count: sentLastHour } = await supabase
      .from("broadcast_recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaign_id)
      .eq("status", "sent")
      .gte("sent_at", oneHourAgo);

    if ((sentLastHour ?? 0) >= limitPerHour) {
      console.log(
        `[broadcast-worker] Rate limit reached (${sentLastHour}/${limitPerHour}/h), re-scheduling in 5min`,
      );
      scheduleNext(supabaseUrl, supabaseServiceKey, campaign_id, 5 * 60);
      return respond({ ok: true, rate_limited: true });
    }

    // Pick the next single pending recipient
    const { data: recipients, error: rErr } = await supabase
      .from("broadcast_recipients")
      .select("*")
      .eq("campaign_id", campaign_id)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1);

    if (rErr) {
      console.error("[broadcast-worker] Error fetching recipients:", rErr);
      return respond({ error: "DB error fetching recipients" }, 500);
    }

    if (!recipients || recipients.length === 0) {
      // No more pending — mark campaign complete
      await supabase
        .from("broadcast_campaigns")
        .update({ status: "completed" })
        .eq("id", campaign_id);
      console.log(`[broadcast-worker] Campaign ${campaign_id} completed`);
      return respond({ ok: true, completed: true });
    }

    const recipient = recipients[0];

    // Mark as sending before the API call
    await supabase
      .from("broadcast_recipients")
      .update({ status: "sending" })
      .eq("id", recipient.id);

    try {
      const phone = recipient.phone.replace(/\D/g, "");
      const payload = campaign.payload as Record<string, any>;
      const payloadType = campaign.payload_type;
      const campaignButtons = (campaign as any).buttons as
        | Array<{ label: string; value: string }>
        | null;

      let sendUrl: string;
      let sendBody: Record<string, any>;

      if (
        payloadType === "interactive" &&
        campaignButtons &&
        campaignButtons.length > 0
      ) {
        let text = payload.text || "";
        const vars = (recipient.variables || {}) as Record<string, any>;
        text = text.replace(/\{\{nome\}\}/gi, recipient.name || "");
        for (const [key, val] of Object.entries(vars)) {
          text = text.replace(
            new RegExp(`\\{\\{${key}\\}\\}`, "gi"),
            String(val ?? ""),
          );
        }
        sendUrl = `${evolutionBaseUrl}/message/sendButtons/${campaign.instance_name}`;
        sendBody = {
          number: phone,
          title: "",
          description: text,
          footer: "",
          buttons: campaignButtons.map((b) => ({
            type: "reply",
            buttonId: b.value,
            buttonText: { displayText: b.label },
          })),
        };
      } else if (payloadType === "text" || payloadType === "interactive") {
        let text = payload.text || "";
        const vars = (recipient.variables || {}) as Record<string, any>;
        text = text.replace(/\{\{nome\}\}/gi, recipient.name || "");
        for (const [key, val] of Object.entries(vars)) {
          text = text.replace(
            new RegExp(`\\{\\{${key}\\}\\}`, "gi"),
            String(val ?? ""),
          );
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
      } else if (payloadType === "audio") {
        sendUrl =
          `${evolutionBaseUrl}/message/sendWhatsAppAudio/${campaign.instance_name}`;
        sendBody = {
          number: phone,
          audio: payload.audio_url,
          encoding: true,
        };
      } else if (payloadType === "document") {
        sendUrl = `${evolutionBaseUrl}/message/sendMedia/${campaign.instance_name}`;
        sendBody = {
          number: phone,
          mediatype: "document",
          media: payload.media_url,
          fileName: payload.file_name || "documento",
          caption: payload.caption || "",
        };
      } else {
        sendUrl = `${evolutionBaseUrl}/message/sendText/${campaign.instance_name}`;
        sendBody = { number: phone, text: "[mídia não suportada]" };
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
        console.error(
          `[broadcast-worker] Send failed for ${phone} (${res.status}):`,
          resData,
        );
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
        console.log(`[broadcast-worker] Sent to ${phone}, messageId=${messageId}`);
      }
    } catch (err) {
      await supabase
        .from("broadcast_recipients")
        .update({
          status: "failed",
          error: String(err).substring(0, 500),
        })
        .eq("id", recipient.id);
      console.error(`[broadcast-worker] Exception sending to recipient ${recipient.id}:`, err);
    }

    // Schedule the next recipient after a random delay (anti-spam)
    const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    console.log(`[broadcast-worker] Scheduling next recipient in ${delay}s`);
    scheduleNext(supabaseUrl, supabaseServiceKey, campaign_id, delay);

    return respond({ ok: true, campaign_id, next_in_seconds: delay });
  } catch (err) {
    console.error("[broadcast-worker] Unhandled error:", err);
    return respond({ error: String(err) }, 500);
  }
});
