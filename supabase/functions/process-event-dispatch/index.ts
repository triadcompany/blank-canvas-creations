import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Retry delays in seconds: 60, 300, 900, 3600, 21600
const RETRY_DELAYS = [60, 300, 900, 3600, 21600];

async function hashSHA256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const processed: string[] = [];
  const errors: string[] = [];

  try {
    // Fetch pending jobs ready to process
    const { data: jobs, error: fetchErr } = await supabase
      .from("event_dispatch_queue")
      .select("*")
      .eq("status", "pending")
      .or("next_retry_at.is.null,next_retry_at.lte." + new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(20);

    if (fetchErr) {
      console.error("[process-event-dispatch] Fetch error:", fetchErr);
      return new Response(JSON.stringify({ ok: false, error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[process-event-dispatch] Processing ${jobs.length} jobs`);

    for (const job of jobs) {
      try {
        // Mark as processing
        await supabase
          .from("event_dispatch_queue")
          .update({ status: "processing" })
          .eq("id", job.id);

        // Route by channel
        if (job.channel === "meta_capi") {
          await processMetaCapi(supabase, job);
        } else {
          // Future channels: google_offline, tiktok, webhook, etc.
          console.warn(`[process-event-dispatch] Unknown channel: ${job.channel}`);
          await markError(supabase, job, `Unknown channel: ${job.channel}`);
        }

        processed.push(job.id);
      } catch (err: any) {
        console.error(`[process-event-dispatch] Job ${job.id} error:`, err);
        await markRetryOrError(supabase, job, err.message || "Unknown error");
        errors.push(job.id);
      }
    }
  } catch (err: any) {
    console.error("[process-event-dispatch] Unhandled error:", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, processed: processed.length, errors: errors.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

// ── Meta CAPI processor ──
async function processMetaCapi(supabase: any, job: any) {
  const orgId = job.organization_id;
  const payload = job.payload || {};

  // 1. Load meta_capi_settings for this org
  const { data: settings } = await supabase
    .from("meta_capi_settings")
    .select("*")
    .eq("organization_id", orgId)
    .eq("enabled", true)
    .maybeSingle();

  if (!settings) {
    await markError(supabase, job, "META_DISABLED: Meta CAPI not enabled for this organization");
    return;
  }

  if (!settings.pixel_id || !settings.access_token) {
    await markError(supabase, job, "MISSING_CREDENTIALS: pixel_id or access_token not configured");
    return;
  }

  // 2. Build Meta payload from stored payload
  const eventName = payload.event_name || job.event_name;
  const eventTime = payload.event_time || Math.floor(Date.now() / 1000);
  const eventId = job.event_hash;

  // Build user_data with hashing
  const userData: Record<string, any> = {};
  if (payload.phone) {
    const cleanPhone = payload.phone.replace(/\D/g, "");
    const normalizedPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;
    userData.ph = [await hashSHA256(normalizedPhone)];
  }
  if (payload.email) {
    userData.em = [await hashSHA256(payload.email.toLowerCase().trim())];
  }
  if (payload.name) {
    const parts = payload.name.trim().split(" ");
    userData.fn = [await hashSHA256(parts[0].toLowerCase())];
    if (parts.length > 1) userData.ln = [await hashSHA256(parts[parts.length - 1].toLowerCase())];
  }
  if (payload.lead_id) {
    userData.external_id = [await hashSHA256(payload.lead_id)];
  }

  const customData: Record<string, any> = {
    currency: payload.currency || "BRL",
    lead_id: payload.lead_id || null,
    pipeline_id: payload.pipeline_id || null,
    stage_id: payload.stage_id || null,
    stage_name: payload.stage_name || null,
  };
  if (payload.value) customData.value = payload.value;

  const eventSourceUrl = settings.domain || "https://autolead.lovable.app";

  const metaPayload: any = {
    data: [
      {
        event_name: eventName,
        event_time: eventTime,
        event_id: eventId,
        event_source_url: eventSourceUrl,
        action_source: "system_generated",
        user_data: userData,
        custom_data: customData,
      },
    ],
  };

  // Test mode
  if (settings.test_mode && settings.test_event_code) {
    metaPayload.test_event_code = settings.test_event_code;
  }

  // 3. Send to Meta Graph API
  const metaUrl = `https://graph.facebook.com/v20.0/${settings.pixel_id}/events?access_token=${settings.access_token}`;

  const res = await fetch(metaUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metaPayload),
  });

  const responseJson = await res.json();

  if (res.ok) {
    // Success!
    await supabase
      .from("event_dispatch_queue")
      .update({
        status: "success",
        sent_at: new Date().toISOString(),
        attempts: job.attempts + 1,
        payload: {
          ...payload,
          _meta_request: metaPayload,
          _meta_response: responseJson,
          _http_status: res.status,
        },
      })
      .eq("id", job.id);

    // Also log to meta_capi_logs for backward compat
    await supabase.from("meta_capi_logs").insert({
      organization_id: orgId,
      lead_id: payload.lead_id || null,
      pipeline_id: payload.pipeline_id || null,
      stage_id: payload.stage_id || null,
      meta_event: eventName,
      status: "success",
      http_status: res.status,
      request_json: metaPayload,
      response_json: responseJson,
      trace_id: payload.trace_id || null,
    });

    console.log(`[process-event-dispatch] ✅ ${eventName} sent for lead ${payload.lead_id}`);
  } else {
    // Meta returned an error
    const errorMsg = `META_HTTP_${res.status}: ${JSON.stringify(responseJson?.error || responseJson)}`;
    await markRetryOrError(supabase, job, errorMsg, metaPayload, responseJson, res.status);
  }
}

// ── Mark job for retry or final error ──
async function markRetryOrError(
  supabase: any,
  job: any,
  errorMsg: string,
  metaRequest?: any,
  metaResponse?: any,
  httpStatus?: number
) {
  const newAttempts = job.attempts + 1;
  const orgId = job.organization_id;
  const payload = job.payload || {};

  if (newAttempts >= job.max_attempts) {
    // Final error
    await supabase
      .from("event_dispatch_queue")
      .update({
        status: "error",
        attempts: newAttempts,
        last_error: errorMsg,
        payload: metaRequest
          ? { ...payload, _meta_request: metaRequest, _meta_response: metaResponse, _http_status: httpStatus }
          : payload,
      })
      .eq("id", job.id);

    // Log failure
    await supabase.from("meta_capi_logs").insert({
      organization_id: orgId,
      lead_id: payload.lead_id || null,
      pipeline_id: payload.pipeline_id || null,
      stage_id: payload.stage_id || null,
      meta_event: payload.event_name || job.event_name,
      status: "failed",
      http_status: httpStatus || null,
      request_json: metaRequest || null,
      response_json: metaResponse || null,
      fail_reason: errorMsg,
      trace_id: payload.trace_id || null,
    });

    console.error(`[process-event-dispatch] ❌ Job ${job.id} permanently failed after ${newAttempts} attempts`);
  } else {
    // Schedule retry with exponential backoff
    const delaySeconds = RETRY_DELAYS[Math.min(newAttempts - 1, RETRY_DELAYS.length - 1)];
    const nextRetry = new Date(Date.now() + delaySeconds * 1000).toISOString();

    await supabase
      .from("event_dispatch_queue")
      .update({
        status: "pending",
        attempts: newAttempts,
        last_error: errorMsg,
        next_retry_at: nextRetry,
      })
      .eq("id", job.id);

    console.warn(
      `[process-event-dispatch] ⏳ Job ${job.id} retry #${newAttempts} scheduled for ${nextRetry} (${delaySeconds}s delay)`
    );
  }
}

// ── Mark as permanent error (no retry) ──
async function markError(supabase: any, job: any, errorMsg: string) {
  await supabase
    .from("event_dispatch_queue")
    .update({
      status: "error",
      attempts: job.attempts + 1,
      last_error: errorMsg,
    })
    .eq("id", job.id);

  console.error(`[process-event-dispatch] ❌ Job ${job.id} error (no retry): ${errorMsg}`);
}
