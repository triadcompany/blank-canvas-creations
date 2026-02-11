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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");
  const evolutionBaseUrl = Deno.env.get("EVOLUTION_BASE_URL");
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (!OPENAI_API_KEY) return respond({ error: "OPENAI_API_KEY not configured" }, 500);

  try {
    // Fetch pending jobs (FIFO)
    const { data: jobs, error: jobsError } = await supabase
      .from("ai_auto_reply_jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);

    if (jobsError) {
      console.error("[ai-auto-reply] Error fetching jobs:", jobsError);
      return respond({ error: jobsError.message }, 500);
    }

    if (!jobs || jobs.length === 0) {
      return respond({ processed: 0, message: "No pending jobs" });
    }

    console.log(`[ai-auto-reply] Found ${jobs.length} pending jobs`);

    let processed = 0;
    let failed = 0;

    for (const job of jobs) {
      try {
        // Mark as processing
        await supabase.from("ai_auto_reply_jobs")
          .update({ status: "processing" })
          .eq("id", job.id);

        const result = await processJob(supabase, job, OPENAI_API_KEY, evolutionApiKey!, evolutionBaseUrl!);

        await supabase.from("ai_auto_reply_jobs")
          .update({
            status: result.status,
            result: result.data || null,
            error: result.error || null,
            processed_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        // Always clear ai_pending when job finishes
        await supabase.from("conversations")
          .update({ ai_pending: false, ai_pending_started_at: null })
          .eq("id", job.conversation_id);

        if (result.status === "completed") processed++;
        else failed++;
      } catch (err) {
        console.error(`[ai-auto-reply] Job ${job.id} error:`, err);
        await supabase.from("ai_auto_reply_jobs")
          .update({ status: "failed", error: String(err), processed_at: new Date().toISOString() })
          .eq("id", job.id);
        // Clear ai_pending on failure too
        await supabase.from("conversations")
          .update({ ai_pending: false, ai_pending_started_at: null })
          .eq("id", job.conversation_id);
        failed++;
      }
    }

    return respond({ processed, failed });
  } catch (err) {
    console.error("[ai-auto-reply] Error:", err);
    return respond({ error: String(err) }, 500);
  }
});

async function processJob(
  supabase: any,
  job: any,
  openaiKey: string,
  evolutionApiKey: string,
  evolutionBaseUrl: string,
): Promise<{ status: string; data?: any; error?: string }> {
  const { organization_id: orgId, conversation_id: convId, inbound_message_id } = job;
  const startTime = Date.now();

  // ── 1. SLA delay: random 10-40 seconds ──
  const delaySec = 10 + Math.random() * 30;
  console.log(`[ai-auto-reply] Job=${job.id} waiting ${delaySec.toFixed(1)}s (SLA delay)`);
  await new Promise(resolve => setTimeout(resolve, delaySec * 1000));

  // ── 2. Fetch conversation (fresh state) ──
  const { data: conv, error: convError } = await supabase
    .from("conversations")
    .select("*, lead:leads!lead_id(id, name, stage_id, stage:pipeline_stages!stage_id(id, name, pipeline_id, sensitive))")
    .eq("id", convId)
    .eq("organization_id", orgId)
    .single();

  if (convError || !conv) {
    return { status: "failed", error: `Conv not found: ${convError?.message || "missing"}` };
  }

  // ── 3. ONLY 3 allowed blockers ──

  // 3a. Human took over
  if (conv.ai_state === "human_active") {
    console.log(`[ai-auto-reply] CANCELLED job=${job.id}: human_active`);
    return { status: "cancelled_human", data: { reason: "human_active" } };
  }

  // 3b. AI mode changed
  if (conv.ai_mode !== "auto") {
    console.log(`[ai-auto-reply] CANCELLED job=${job.id}: ai_mode=${conv.ai_mode}`);
    return { status: "cancelled_human", data: { reason: `ai_mode_changed_to_${conv.ai_mode}` } };
  }

  // 3c. Sensitive stage
  if (conv.lead?.stage?.sensitive === true) {
    console.log(`[ai-auto-reply] CANCELLED job=${job.id}: sensitive stage "${conv.lead.stage.name}"`);
    await supabase.from("conversations")
      .update({ ai_state: "human_active" })
      .eq("id", convId);
    return { status: "cancelled_sensitive_stage", data: { stage: conv.lead.stage.name } };
  }

  // 3d. Check if human sent a manual message AFTER the inbound
  const { data: humanMsgs } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", convId)
    .eq("organization_id", orgId)
    .eq("direction", "outbound")
    .eq("ai_generated", false)
    .gt("created_at", job.created_at)
    .limit(1);

  if (humanMsgs && humanMsgs.length > 0) {
    console.log(`[ai-auto-reply] CANCELLED job=${job.id}: human sent manual message after inbound`);
    return { status: "cancelled_human", data: { reason: "human_replied_after_inbound" } };
  }

  // ── 4. Build context ──
  const { data: msgs } = await supabase
    .from("messages")
    .select("direction, body, ai_generated, created_at")
    .eq("conversation_id", convId)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(20);

  const messages = (msgs || []).reverse();
  const chatHistory = messages.map((m: any) => {
    const prefix = m.direction === 'inbound' ? 'CLIENTE' : (m.ai_generated ? 'IA' : 'ATENDENTE');
    return `[${prefix}] ${m.body}`;
  }).join("\n");

  // ── 5. Org prompt ──
  const { data: org } = await supabase
    .from("organizations")
    .select("ai_system_prompt")
    .eq("id", orgId)
    .single();

  const contactName = conv.contact_name || conv.contact_phone;
  const orgPrompt = org?.ai_system_prompt || "";

  const systemPrompt = `Você é um assistente comercial de vendas via WhatsApp. Responda de forma curta, natural e empática.
${orgPrompt ? `\nINSTRUÇÕES DA EMPRESA:\n${orgPrompt}\n` : ""}
REGRAS:
- Responda em 1-3 frases (WhatsApp)
- NUNCA mencione que é IA
- Português brasileiro
- Foque em avançar a conversa
- Seja proativo mas não insistente

Contato: ${contactName}`;

  // ── 6. Call OpenAI (gpt-4o-mini, 20s timeout) ──
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let openaiRes: Response;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: chatHistory ? `Histórico:\n${chatHistory}` : "(sem histórico)" },
        ],
        temperature: 0.5,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });
  } catch (fetchErr: any) {
    clearTimeout(timeout);
    if (fetchErr.name === "AbortError") {
      return { status: "failed", error: "OpenAI timeout (20s)" };
    }
    throw fetchErr;
  }
  clearTimeout(timeout);

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    console.error("[ai-auto-reply] OpenAI error:", openaiRes.status, errText.substring(0, 200));
    return { status: "failed", error: `OpenAI ${openaiRes.status}` };
  }

  const openaiData = await openaiRes.json();
  let replyText = openaiData.choices?.[0]?.message?.content?.trim() || "";

  // Strip JSON wrapper if returned
  if (replyText.startsWith("{")) {
    try {
      const parsed = JSON.parse(replyText);
      replyText = parsed.reply || parsed.text || parsed.message || replyText;
    } catch { /* use raw */ }
  }

  if (!replyText) {
    return { status: "completed", data: { responded: false, reason: "empty_reply" } };
  }

  // ── 7. Re-check state before sending (prevent sending after human took over during LLM call) ──
  const { data: freshConv } = await supabase
    .from("conversations")
    .select("ai_state, ai_mode")
    .eq("id", convId)
    .single();

  if (freshConv?.ai_state === "human_active" || freshConv?.ai_mode !== "auto") {
    console.log(`[ai-auto-reply] CANCELLED job=${job.id}: state changed during LLM call`);
    return { status: "cancelled_human", data: { reason: "state_changed_during_llm" } };
  }

  // ── 8. Send via Evolution ──
  const { data: integration } = await supabase
    .from("whatsapp_integrations")
    .select("instance_name, status")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .maybeSingle();

  if (!integration || integration.status !== "connected") {
    return { status: "failed", error: "WhatsApp not connected" };
  }

  const phone = (conv.contact_phone || "").replace(/\D/g, "");
  const sendRes = await fetch(
    `${evolutionBaseUrl}/message/sendText/${integration.instance_name}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: evolutionApiKey },
      body: JSON.stringify({ number: phone, text: replyText }),
    }
  );

  if (!sendRes.ok) {
    const sendErr = await sendRes.text();
    console.error("[ai-auto-reply] Evolution error:", sendErr.substring(0, 200));
    return { status: "failed", error: `Evolution ${sendRes.status}` };
  }

  const sendData = await sendRes.json();
  const externalId = sendData?.key?.id || sendData?.messageId || null;
  const now = new Date().toISOString();
  const latencyMs = Date.now() - startTime;

  // ── 9. Save outbound message ──
  await supabase.from("messages").insert({
    organization_id: orgId,
    conversation_id: convId,
    direction: "outbound",
    body: replyText,
    external_message_id: externalId,
    ai_generated: true,
  });

  // ── 10. Update conversation ──
  await supabase.from("conversations")
    .update({
      last_message_at: now,
      last_message_preview: replyText.substring(0, 100),
      last_ai_reply_at: now,
    })
    .eq("id", convId);

  console.log(`[ai-auto-reply] ✅ Job=${job.id} replied conv=${convId} latency=${latencyMs}ms reply="${replyText.substring(0, 50)}..."`);
  return {
    status: "completed",
    data: { responded: true, latency_ms: latencyMs, reply_preview: replyText.substring(0, 100) },
  };
}
