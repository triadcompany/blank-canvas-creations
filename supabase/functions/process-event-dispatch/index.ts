import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Exponential backoff: 2^attempts minutes (2m, 4m, 8m, 16m, 32m)
function getBackoffMs(attempts: number): number {
  return Math.pow(2, attempts) * 60_000;
}

async function hashSHA256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Removes diacritics/accents from a string (e.g. "José" → "jose")
 */
function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalizes a phone number: digits only, ensures BR prefix (55)
 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("55") ? digits : `55${digits}`;
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
    // Supabase cron runs at 1-minute granularity; we simulate ~10s cadence by processing up to 6 batches.
    for (let i = 0; i < 6; i++) {
      const { processedCount, errorCount, hadWork } = await processBatch(supabase, processed, errors);
      if (!hadWork) break;

      // If there is more work, wait 10s and try again (keeps within typical edge runtime limits)
      if (i < 5) await new Promise((r) => setTimeout(r, 10_000));

      // Avoid infinite loops if errors keep happening
      if (processedCount === 0 && errorCount === 0) break;
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


async function processBatch(
  supabase: any,
  processed: string[],
  errors: string[]
): Promise<{ processedCount: number; errorCount: number; hadWork: boolean }> {
  // Fetch pending/failed jobs ready to process
  const { data: jobs, error: fetchErr } = await supabase
    .from("event_dispatch_queue")
    .select("*")
    .in("status", ["pending", "failed"])
    .or("next_retry_at.is.null,next_retry_at.lte." + new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(50);

  if (fetchErr) {
    throw new Error(fetchErr.message);
  }

  if (!jobs || jobs.length === 0) {
    return { processedCount: 0, errorCount: 0, hadWork: false };
  }

  console.log(`[process-event-dispatch] Processing batch: ${jobs.length} jobs`);

  let processedCount = 0;
  let errorCount = 0;

  for (const job of jobs) {
    try {
      await supabase.from("event_dispatch_queue").update({ status: "processing" }).eq("id", job.id);

      if (job.channel === "meta_capi") {
        await processMetaCapi(supabase, job);
      } else {
        console.warn(`[process-event-dispatch] Unknown channel: ${job.channel}`);
        await markError(supabase, job, `Unknown channel: ${job.channel}`);
      }

      processed.push(job.id);
      processedCount++;
    } catch (err: any) {
      console.error(`[process-event-dispatch] Job ${job.id} error:`, err);
      await markRetryOrError(supabase, job, err.message || "Unknown error");
      errors.push(job.id);
      errorCount++;
    }
  }

  return { processedCount, errorCount, hadWork: true };
}

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

  // 2. DEDUPLICATION CHECK: Skip if already successfully sent with same event_hash
  const { data: alreadySent } = await supabase
    .from("meta_capi_events")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", payload.lead_id || null)
    .eq("event_name", payload.event_name || job.event_name)
    .eq("status", "success")
    .limit(1);

  if (alreadySent && alreadySent.length > 0) {
    console.log(`[process-event-dispatch] DEDUPLICATED: ${payload.event_name} already sent for lead ${payload.lead_id}`);
    await supabase
      .from("event_dispatch_queue")
      .update({
        status: "success",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        attempts: job.attempts + 1,
        payload: { ...payload, _deduplicated: true, _reason: "Already successfully sent" },
      })
      .eq("id", job.id);
    return;
  }

  // 3. Resolve enrichment data (pipeline name, seller name) from DB if not in payload
  let pipelineName = payload.pipeline_name || null;
  let stageName = payload.stage_name || null;
  let sellerName = payload.seller_name || null;

  if (!pipelineName && payload.pipeline_id) {
    const { data: pipeline } = await supabase
      .from("pipelines")
      .select("name")
      .eq("id", payload.pipeline_id)
      .maybeSingle();
    pipelineName = pipeline?.name || null;
  }

  if (!stageName && payload.stage_id) {
    const { data: stage } = await supabase
      .from("pipeline_stages")
      .select("name")
      .eq("id", payload.stage_id)
      .maybeSingle();
    stageName = stage?.name || null;
  }

  if (!sellerName && payload.seller_id) {
    const { data: seller } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", payload.seller_id)
      .maybeSingle();
    sellerName = seller?.name || null;
  }

  // 4. Build Meta payload
  const eventName = payload.event_name || job.event_name;
  const eventTime = payload.event_time || Math.floor(Date.now() / 1000);
  // Use stored event_id (UUID) for stable retry dedup; fallback to event_hash
  const eventId = payload.event_id || job.event_hash;

  // 5. Build user_data with proper normalization + SHA256 hashing
  const userData: Record<string, any> = {};
  if (payload.phone) {
    const normalizedPhone = normalizePhone(payload.phone);
    userData.ph = [await hashSHA256(normalizedPhone)];
  }
  if (payload.email) {
    userData.em = [await hashSHA256(payload.email.toLowerCase().trim())];
  }
  if (payload.name) {
    const cleanName = removeAccents(payload.name.trim().toLowerCase());
    const parts = cleanName.split(/\s+/);
    userData.fn = [await hashSHA256(parts[0])];
    if (parts.length > 1) userData.ln = [await hashSHA256(parts[parts.length - 1])];
  }
  if (payload.lead_id) {
    userData.external_id = [await hashSHA256(payload.lead_id)];
  }

  // 6. Build enriched custom_data
  const customData: Record<string, any> = {
    currency: payload.currency || "BRL",
    value: payload.value || 0,
    lead_id: payload.lead_id || null,
    pipeline: pipelineName || null,
    pipeline_id: payload.pipeline_id || null,
    stage: stageName || null,
    stage_id: payload.stage_id || null,
    seller: sellerName || null,
    source: payload.lead_source || null,
  };

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

  console.log(`[process-event-dispatch] Sending ${eventName} to Meta (event_id=${eventId}, lead=${payload.lead_id}, pipeline=${pipelineName}, stage=${stageName})`);

  // 7. Send to Meta Graph API
  const metaUrl = `https://graph.facebook.com/v20.0/${settings.pixel_id}/events?access_token=${settings.access_token}`;

  const res = await fetch(metaUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metaPayload),
  });

  const responseJson = await res.json();

  // Mask access_token from stored payloads
  const safeMetaPayload = { ...metaPayload };
  delete safeMetaPayload.test_event_code; // don't store test code

  if (res.ok) {
    // 8a. Success — update queue and audit log
    await supabase
      .from("event_dispatch_queue")
      .update({
        status: "success",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        attempts: job.attempts + 1,
        payload: {
          ...payload,
          _meta_request: safeMetaPayload,
          _meta_response: responseJson,
          _http_status: res.status,
        },
      })
      .eq("id", job.id);

    // Audit log to meta_capi_events
    try {
      await supabase.from("meta_capi_events").insert({
        organization_id: orgId,
        lead_id: payload.lead_id || null,
        pipeline_id: payload.pipeline_id || null,
        stage_id: payload.stage_id || null,
        event_name: eventName,
        status: "success",
        payload_json: safeMetaPayload,
        response_json: responseJson,
        source: "automation",
      });
    } catch (logErr) {
      console.warn("[process-event-dispatch] Failed to write audit log (non-critical):", logErr);
    }

    console.log(`[process-event-dispatch] ✅ ${eventName} sent for lead ${payload.lead_id} (event_id=${eventId})`);
  } else {
    // 8b. Meta returned an error
    const errorMsg = `META_HTTP_${res.status}: ${JSON.stringify(responseJson?.error || responseJson)}`;
    await markRetryOrError(supabase, job, errorMsg, safeMetaPayload, responseJson, res.status);
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
    // Final dead state
    await supabase
      .from("event_dispatch_queue")
      .update({
        status: "dead",
        attempts: newAttempts,
        last_error: errorMsg,
        updated_at: new Date().toISOString(),
        payload: metaRequest
          ? { ...payload, _meta_request: metaRequest, _meta_response: metaResponse, _http_status: httpStatus }
          : payload,
      })
      .eq("id", job.id);

    // Audit log failure to meta_capi_events (best-effort)
    try {
      await supabase.from("meta_capi_events").insert({
        organization_id: orgId,
        lead_id: payload.lead_id || null,
        pipeline_id: payload.pipeline_id || null,
        stage_id: payload.stage_id || null,
        event_name: payload.event_name || job.event_name,
        status: "error",
        payload_json: metaRequest || null,
        response_json: metaResponse || null,
        fail_reason: errorMsg,
        source: "automation",
      });
    } catch (logErr) {
      console.warn("[process-event-dispatch] Failed to write error audit log (non-critical):", logErr);
    }

    console.error(`[process-event-dispatch] ❌ Job ${job.id} permanently DEAD after ${newAttempts} attempts`);
  } else {
    // Schedule retry with exponential backoff: 2^n minutes
    const backoffMs = getBackoffMs(newAttempts);
    const nextRetry = new Date(Date.now() + backoffMs).toISOString();

    await supabase
      .from("event_dispatch_queue")
      .update({
        status: "failed",
        attempts: newAttempts,
        last_error: errorMsg,
        next_retry_at: nextRetry,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    console.warn(
      `[process-event-dispatch] ⏳ Job ${job.id} retry #${newAttempts} scheduled for ${nextRetry} (${Math.round(backoffMs/60000)}m backoff)`
    );
  }
}

// ── Mark as permanent error (no retry) ──
async function markError(supabase: any, job: any, errorMsg: string) {
  await supabase
    .from("event_dispatch_queue")
    .update({
      status: "dead",
      attempts: job.attempts + 1,
      last_error: errorMsg,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  console.error(`[process-event-dispatch] ❌ Job ${job.id} DEAD (no retry): ${errorMsg}`);
}
