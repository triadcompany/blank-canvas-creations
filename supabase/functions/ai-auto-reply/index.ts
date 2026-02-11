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
    // ── 1. Pick pending jobs ──
    console.log("[ai-auto-reply] Worker started, looking for pending jobs...");
    
    const { data: jobs, error: jobsError } = await supabase
      .from("ai_auto_reply_jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(5);

    if (jobsError) {
      console.error("[ai-auto-reply] Error fetching jobs:", jobsError);
      return respond({ error: "Failed to fetch jobs", detail: jobsError.message }, 500);
    }

    console.log(`[ai-auto-reply] Found ${jobs?.length || 0} pending jobs`);

    if (!jobs || jobs.length === 0) {
      return respond({ processed: 0, message: "No pending jobs" });
    }

    let processed = 0;
    let failed = 0;

    for (const job of jobs) {
      try {
        // Mark as processing
        await supabase.from("ai_auto_reply_jobs")
          .update({ status: "processing" })
          .eq("id", job.id);

        const result = await processAutoReply(supabase, job, OPENAI_API_KEY, evolutionApiKey!, evolutionBaseUrl!);

        await supabase.from("ai_auto_reply_jobs")
          .update({
            status: result.status,
            result: result.data,
            error: result.error || null,
            processed_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        if (result.status === "completed") processed++;
        else failed++;

      } catch (err) {
        console.error(`[ai-auto-reply] Job ${job.id} error:`, err);
        await supabase.from("ai_auto_reply_jobs")
          .update({ status: "failed", error: String(err), processed_at: new Date().toISOString() })
          .eq("id", job.id);
        failed++;
      }
    }

    return respond({ processed, failed });
  } catch (err) {
    console.error("[ai-auto-reply] Error:", err);
    return respond({ error: String(err) }, 500);
  }
});

async function processAutoReply(
  supabase: any,
  job: any,
  openaiKey: string,
  evolutionApiKey: string,
  evolutionBaseUrl: string,
): Promise<{ status: string; data?: any; error?: string }> {
  const { organization_id: orgId, conversation_id: convId, inbound_message_id } = job;
  console.log(`[ai-auto-reply] Processing job=${job.id} conv=${convId} org=${orgId}`);

  // ── 2. Fetch conversation ──
  const { data: conv, error: convError } = await supabase
    .from("conversations")
    .select("*, lead:leads!lead_id(id, name, stage_id, stage:pipeline_stages!stage_id(id, name, pipeline_id, sensitive))")
    .eq("id", convId)
    .eq("organization_id", orgId)
    .single();

  if (convError) {
    console.error(`[ai-auto-reply] Conv fetch error:`, convError);
    return { status: "failed", error: `Conv fetch error: ${convError.message}` };
  }

  if (!conv) return { status: "failed", error: "Conversation not found" };

  // ── 3. Guardrails ──
  console.log(`[ai-auto-reply] Guardrails: ai_mode=${conv.ai_mode} ai_state=${conv.ai_state} lead_stage=${conv.lead?.stage?.name}`);
  
  if (conv.ai_mode !== "auto") return { status: "blocked", error: "ai_mode != auto" };
  if (conv.ai_state === "human_active") return { status: "blocked", error: "human_active lock" };

  // Check sensitive stage
  if (conv.lead?.stage?.sensitive === true) {
    // Publish handoff event
    await supabase.from("automation_events").insert({
      organization_id: orgId,
      event_name: "handoff.to_human.by_ai",
      entity_type: "conversation",
      entity_id: convId,
      source: "ai",
      payload: { reason: "sensitive_stage", stage_name: conv.lead.stage.name },
      status: "pending",
    }).catch(() => {});

    await supabase.from("conversations")
      .update({ ai_state: "human_active" })
      .eq("id", convId);

    return { status: "blocked", error: `Sensitive stage: ${conv.lead.stage.name}` };
  }

  // ── 4. Throttle checks ──
  const { data: org } = await supabase
    .from("organizations")
    .select("ai_system_prompt, ai_auto_reply_throttle_seconds, ai_auto_max_without_reply, ai_auto_debounce_seconds")
    .eq("id", orgId)
    .single();

  const throttleSec = org?.ai_auto_reply_throttle_seconds || 20;
  const maxWithoutReply = org?.ai_auto_max_without_reply || 2;

  // Throttle: last AI reply too recent?
  if (conv.last_ai_reply_at) {
    const elapsed = (Date.now() - new Date(conv.last_ai_reply_at).getTime()) / 1000;
    if (elapsed < throttleSec) {
      return { status: "throttled", error: `Throttled: ${elapsed.toFixed(0)}s < ${throttleSec}s` };
    }
  }

  // Max without reply
  if (conv.ai_reply_count_since_last_lead >= maxWithoutReply) {
    return { status: "throttled", error: `Max ${maxWithoutReply} AI replies without lead response` };
  }

  // ── 5. Debounce: check if newer inbound arrived ──
  const debounceSec = org?.ai_auto_debounce_seconds || 4;
  await new Promise(resolve => setTimeout(resolve, debounceSec * 1000));

  // Check if a newer inbound message arrived during debounce
  const { data: newerMsgs } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", convId)
    .eq("organization_id", orgId)
    .eq("direction", "inbound")
    .gt("id", inbound_message_id)
    .limit(1);

  if (newerMsgs && newerMsgs.length > 0) {
    return { status: "throttled", error: "Newer inbound arrived during debounce — skipping" };
  }

  // Re-check ai_state after debounce (human may have intervened)
  const { data: convRefresh } = await supabase
    .from("conversations")
    .select("ai_state, ai_mode")
    .eq("id", convId)
    .single();

  if (convRefresh?.ai_state === "human_active" || convRefresh?.ai_mode !== "auto") {
    return { status: "blocked", error: "State changed during debounce" };
  }

  // ── 6. Fetch messages for context ──
  const { data: msgs } = await supabase
    .from("messages")
    .select("direction, body, created_at, ai_generated")
    .eq("conversation_id", convId)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(30);

  const messages = (msgs || []).reverse();

  // ── 7. Fetch pipeline stages ──
  let pipelineStages: any[] = [];
  let defaultPipelineId: string | null = null;

  const { data: defaultPipeline } = await supabase
    .from("pipelines")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (defaultPipeline) {
    defaultPipelineId = defaultPipeline.id;
    const { data: stages } = await supabase
      .from("pipeline_stages")
      .select("id, name, position, sensitive")
      .eq("pipeline_id", defaultPipeline.id)
      .eq("is_active", true)
      .order("position", { ascending: true });
    pipelineStages = stages || [];
  }

  const stageMap: Record<string, { id: string; name: string; sensitive: boolean }> = {};
  for (const s of pipelineStages) {
    stageMap[s.name.toLowerCase()] = { id: s.id, name: s.name, sensitive: s.sensitive };
  }
  const availableStageNames = pipelineStages.map((s: any) => s.name).join(", ");

  // ── 8. Build AI prompt ──
  const contactName = conv.contact_name || conv.contact_phone;
  const currentStageName = conv.lead?.stage?.name || null;
  const leadInfo = conv.lead
    ? `Lead vinculado: "${conv.lead.name}", etapa atual: "${currentStageName || 'N/A'}"`
    : "Sem lead vinculado.";

  const chatHistory = messages.map((m: any) => {
    const prefix = m.direction === 'inbound' ? 'CLIENTE' : (m.ai_generated ? 'IA' : 'ATENDENTE');
    return `[${prefix}] ${m.body}`;
  }).join("\n");

  const orgPrompt = org?.ai_system_prompt || "";

  const systemPrompt = `Você é um assistente comercial de vendas via WhatsApp. Responda ao cliente de forma natural, empática e comercial.

${orgPrompt ? `INSTRUÇÕES DA EMPRESA:\n${orgPrompt}\n` : ""}
CONTEXTO:
- Contato: ${contactName}
- ${leadInfo}
- Etapas do pipeline: ${availableStageNames || "Nenhuma"}

REGRAS:
- Responda de forma curta e natural (WhatsApp)
- Seja proativo mas não insistente
- NUNCA mencione que é uma IA
- Foque em avançar a negociação
- Português brasileiro

REGRAS DE ETAPA:
- Sugira mudança APENAS se claramente necessário
- Use APENAS nomes de etapas existentes: ${availableStageNames}
- Se a etapa sugerida == etapa atual ("${currentStageName}"), retorne suggested_stage_name=null
- Forneça confidence de 0.0 a 1.0 para a ação
- Etapas sensíveis (NÃO sugerir): ${pipelineStages.filter(s => s.sensitive).map(s => s.name).join(", ") || "nenhuma"}

Responda EXATAMENTE neste JSON:
{
  "reply": "texto da resposta para o cliente",
  "intent": "string (greeting|interest|question|objection|closing|scheduling|other)",
  "confidence": 0.0,
  "actions": [
    {"type":"suggest_stage","stage_name":"NomeExato","reason":"motivo","confidence":0.85}
  ],
  "handoff_required": false,
  "handoff_reason": ""
}`;

  // ── 9. Call OpenAI ──
  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Histórico:\n\n${chatHistory || "(sem mensagens)"}` },
      ],
      temperature: 0.5,
      max_tokens: 500,
    }),
  });

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    console.error("[ai-auto-reply] OpenAI error:", errText);
    return { status: "failed", error: `OpenAI error: ${openaiRes.status}` };
  }

  const openaiData = await openaiRes.json();
  const rawContent = openaiData.choices?.[0]?.message?.content || "{}";

  let aiResult: any;
  try {
    const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawContent];
    aiResult = JSON.parse(jsonMatch[1].trim());
  } catch {
    aiResult = { reply: rawContent, intent: "unknown", confidence: 0.3, actions: [], handoff_required: false };
  }

  // ── 10. Handoff check ──
  if (aiResult.handoff_required) {
    await supabase.from("conversations")
      .update({ ai_state: "human_active" })
      .eq("id", convId);

    await supabase.from("automation_events").insert({
      organization_id: orgId,
      event_name: "handoff.to_human.by_ai",
      entity_type: "conversation",
      entity_id: convId,
      source: "ai",
      payload: { reason: aiResult.handoff_reason || "AI requested handoff" },
      status: "pending",
    }).catch(() => {});

    return { status: "completed", data: { ...aiResult, action: "handoff" } };
  }

  // ── 11. Log to ai_interactions ──
  const { data: interactionData } = await supabase.from("ai_interactions").insert({
    organization_id: orgId,
    agent_name: "auto-reply",
    interaction_type: "auto_reply",
    input_data: {
      conversation_id: convId,
      inbound_message_id,
      lead_id: conv.lead?.id || null,
      ai_mode: "auto",
      messages_count: messages.length,
    },
    output_data: aiResult,
    status: "completed",
  }).select("id").single();

  const aiInteractionId = interactionData?.id || null;

  // ── 12. Send message via Evolution ──
  const replyText = aiResult.reply?.trim();
  if (!replyText) {
    return { status: "completed", data: { ...aiResult, action: "no_reply" } };
  }

  // Get WhatsApp integration
  const { data: integration } = await supabase
    .from("whatsapp_integrations")
    .select("instance_name, status")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .maybeSingle();

  if (!integration || integration.status !== "connected") {
    return { status: "failed", error: "WhatsApp not connected" };
  }

  const phone = conv.contact_phone.replace(/\D/g, "");
  const sendRes = await fetch(
    `${evolutionBaseUrl}/message/sendText/${integration.instance_name}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: evolutionApiKey },
      body: JSON.stringify({ number: phone, text: replyText }),
    }
  );

  const sendData = await sendRes.json();
  if (!sendRes.ok) {
    console.error("[ai-auto-reply] Evolution send error:", sendData);
    return { status: "failed", error: `Evolution error: ${JSON.stringify(sendData)}` };
  }

  const externalId = sendData?.key?.id || sendData?.messageId || null;
  const now = new Date().toISOString();

  // ── 13. Save outbound message ──
  await supabase.from("messages").insert({
    organization_id: orgId,
    conversation_id: convId,
    direction: "outbound",
    body: replyText,
    external_message_id: externalId,
    ai_generated: true,
    ai_interaction_id: aiInteractionId,
  });

  // ── 14. Update conversation ──
  await supabase.from("conversations")
    .update({
      last_message_at: now,
      last_message_preview: replyText.substring(0, 100),
      last_ai_reply_at: now,
      ai_reply_count_since_last_lead: (conv.ai_reply_count_since_last_lead || 0) + 1,
    })
    .eq("id", convId);

  // ── 15. Publish event ──
  await supabase.from("automation_events").insert({
    organization_id: orgId,
    event_name: "conversation.ai_message_sent",
    entity_type: "conversation",
    entity_id: convId,
    source: "ai",
    payload: {
      reply: replyText,
      intent: aiResult.intent,
      confidence: aiResult.confidence,
      ai_interaction_id: aiInteractionId,
    },
    status: "pending",
    idempotency_key: `${orgId}:ai_msg:${convId}:${job.inbound_message_id}`,
  }).catch(() => {});

  // ── 16. Stage movement (controlled) ──
  const stageActions = (aiResult.actions || []).filter(
    (a: any) => a.type === "suggest_stage" && a.stage_name
  );

  for (const action of stageActions) {
    const matched = stageMap[action.stage_name.toLowerCase()];
    if (!matched) continue;
    if (matched.sensitive) continue;
    if (matched.id === conv.lead?.stage?.id) continue;

    const confidence = action.confidence || aiResult.confidence || 0;

    if (confidence >= 0.80 && conv.lead?.id) {
      // Auto-move
      await supabase.from("leads")
        .update({ stage_id: matched.id, updated_at: now })
        .eq("id", conv.lead.id);

      await supabase.from("automation_events").insert({
        organization_id: orgId,
        event_name: "lead.stage_changed.by_ai",
        entity_type: "lead",
        entity_id: conv.lead.id,
        source: "ai",
        payload: {
          from_stage: currentStageName,
          to_stage: matched.name,
          reason: action.reason,
          confidence,
          ai_interaction_id: aiInteractionId,
        },
        status: "pending",
        idempotency_key: `${orgId}:stage:${conv.lead.id}:${matched.id}:${now.substring(0, 10)}`,
      }).catch(() => {});

      console.log(`[ai-auto-reply] Stage moved: ${currentStageName} → ${matched.name} (confidence=${confidence})`);
    } else if (conv.lead?.id) {
      // Suggest only
      await supabase.from("automation_events").insert({
        organization_id: orgId,
        event_name: "lead.stage_change_suggested.by_ai",
        entity_type: "lead",
        entity_id: conv.lead.id,
        source: "ai",
        payload: {
          suggested_stage: matched.name,
          reason: action.reason,
          confidence,
          ai_interaction_id: aiInteractionId,
        },
        status: "pending",
      }).catch(() => {});
    }
  }

  console.log(`[ai-auto-reply] Replied to conv=${convId} intent=${aiResult.intent}`);
  return { status: "completed", data: { reply: replyText, intent: aiResult.intent, confidence: aiResult.confidence } };
}
