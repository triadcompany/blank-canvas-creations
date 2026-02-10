import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { conversation_id, organization_id } = await req.json();
    if (!conversation_id || !organization_id) {
      return new Response(JSON.stringify({ error: "conversation_id and organization_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Fetch conversation with lead info
    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("*, lead:leads!lead_id(id, name, stage_id, stage:pipeline_stages!stage_id(id, name, pipeline_id))")
      .eq("id", conversation_id)
      .eq("organization_id", organization_id)
      .single();

    if (convErr || !conv) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch last 20 messages
    const { data: msgs } = await supabase
      .from("messages")
      .select("direction, body, created_at")
      .eq("conversation_id", conversation_id)
      .eq("organization_id", organization_id)
      .order("created_at", { ascending: false })
      .limit(20);

    const messages = (msgs || []).reverse();

    // 3. Fetch pipeline stages for stage suggestion resolution
    let pipelineStages: any[] = [];
    let defaultPipelineId: string | null = null;

    // Get default pipeline for org
    const { data: defaultPipeline } = await supabase
      .from("pipelines")
      .select("id, name")
      .eq("organization_id", organization_id)
      .eq("is_default", true)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (defaultPipeline) {
      defaultPipelineId = defaultPipeline.id;
      const { data: stages } = await supabase
        .from("pipeline_stages")
        .select("id, name, position")
        .eq("pipeline_id", defaultPipeline.id)
        .eq("is_active", true)
        .order("position", { ascending: true });
      pipelineStages = stages || [];
    }

    // Build stage name -> id map (case-insensitive)
    const stageMap: Record<string, { id: string; name: string }> = {};
    for (const s of pipelineStages) {
      stageMap[s.name.toLowerCase()] = { id: s.id, name: s.name };
    }

    // Available stage names for prompt context
    const availableStageNames = pipelineStages.map((s: any) => s.name).join(", ");

    // 4. Build context for GPT
    const contactName = conv.contact_name || conv.contact_phone;
    const currentStageName = conv.lead?.stage?.name || null;
    const currentStageId = conv.lead?.stage?.id || null;
    const leadInfo = conv.lead
      ? `Lead vinculado: "${conv.lead.name}", etapa atual: "${currentStageName || 'N/A'}"`
      : "Sem lead vinculado.";
    const assignedInfo = conv.assigned_to ? `Responsável atribuído: sim` : `Sem responsável atribuído.`;

    const chatHistory = messages.map((m: any) =>
      `[${m.direction === 'inbound' ? 'CLIENTE' : 'ATENDENTE'}] ${m.body}`
    ).join("\n");

    const systemPrompt = `Você é um assistente de vendas comercial inteligente. Sua função é analisar conversas de WhatsApp e sugerir a melhor resposta e ação de funil para o atendente humano.

CONTEXTO:
- Contato: ${contactName}
- ${leadInfo}
- ${assignedInfo}
- Etapas disponíveis no pipeline: ${availableStageNames || "Nenhuma"}

REGRAS PARA RESPOSTA:
- Sugira UMA resposta curta e natural (como se fosse por WhatsApp)
- Identifique a intenção do cliente (interest, question, objection, complaint, closing, greeting, purchase_interest, no_interest, scheduling, other)
- Seja direto e comercial, focado em avançar a negociação
- Responda em português brasileiro

REGRAS PARA SUGESTÃO DE ETAPA:
- Analise a conversa e sugira a etapa mais adequada do funil, usando APENAS os nomes de etapas disponíveis listados acima.
- Critérios de sugestão:
  - Primeira interação ou interesse inicial → "Andamento"
  - Lead responde perguntas-chave / confirma interesse real → "Qualificado"
  - Lead confirma data/horário/visita/teste → "Agendado"
  - Lead diz que não quer / sem interesse → "Perdido"
  - Lead não responde e já houve tentativa → "Follow Up"
- Se a etapa sugerida é igual à etapa atual ("${currentStageName || 'N/A'}"), NÃO sugira mudança (retorne suggested_stage_name como null).
- Se não tiver certeza, retorne suggested_stage_name como null e explique no suggested_reason.
- NUNCA invente nomes de etapas. Use APENAS: ${availableStageNames || "os nomes disponíveis"}

Responda EXATAMENTE neste formato JSON:
{
  "intent": "string",
  "summary": "resumo curto da conversa em 1 frase",
  "suggested_reply": "texto da resposta sugerida",
  "suggested_action_type": "move_stage | qualify | followup | handoff | null",
  "suggested_stage_name": "nome exato da etapa ou null",
  "suggested_reason": "motivo curto da sugestão de etapa ou null",
  "confidence": 0.0
}`;

    // 5. Call OpenAI
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Histórico da conversa:\n\n${chatHistory || "(sem mensagens)"}` },
        ],
        temperature: 0.4,
        max_tokens: 600,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI error:", errText);
      return new Response(JSON.stringify({ error: "OpenAI API error", details: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiData = await openaiRes.json();
    const rawContent = openaiData.choices?.[0]?.message?.content || "{}";

    // Parse the JSON response
    let aiResult: any;
    try {
      const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawContent];
      aiResult = JSON.parse(jsonMatch[1].trim());
    } catch {
      aiResult = {
        intent: "unknown",
        summary: "Não foi possível analisar",
        suggested_reply: rawContent,
        suggested_action_type: null,
        suggested_stage_name: null,
        suggested_reason: null,
        confidence: 0.3,
      };
    }

    // 6. Resolve stage suggestion to real IDs
    let suggested_pipeline_id: string | null = null;
    let suggested_stage_id: string | null = null;
    let suggested_stage_name: string | null = aiResult.suggested_stage_name || null;
    let suggested_reason: string | null = aiResult.suggested_reason || null;
    let suggested_action_type: string | null = aiResult.suggested_action_type || null;

    if (suggested_stage_name) {
      const matchedStage = stageMap[suggested_stage_name.toLowerCase()];
      if (matchedStage) {
        suggested_pipeline_id = defaultPipelineId;
        suggested_stage_id = matchedStage.id;
        suggested_stage_name = matchedStage.name; // use canonical name
      } else {
        // Fallback: use first stage
        if (pipelineStages.length > 0) {
          const fallback = pipelineStages[0];
          suggested_pipeline_id = defaultPipelineId;
          suggested_stage_id = fallback.id;
          suggested_stage_name = fallback.name;
          suggested_reason = `Etapa "${aiResult.suggested_stage_name}" não encontrada no pipeline. Sugerido fallback: ${fallback.name}`;
        } else {
          suggested_stage_name = null;
          suggested_reason = `Nenhuma etapa encontrada no pipeline da organização.`;
        }
      }

      // Don't suggest if same as current
      if (suggested_stage_id && suggested_stage_id === currentStageId) {
        suggested_stage_id = null;
        suggested_stage_name = null;
        suggested_pipeline_id = null;
        suggested_reason = "Lead já está nesta etapa.";
        suggested_action_type = null;
      }
    }

    // Build final result
    const finalResult = {
      intent: aiResult.intent || "unknown",
      summary: aiResult.summary || "",
      suggested_reply: aiResult.suggested_reply || "",
      suggested_actions: [], // keep backward compat
      suggested_action_type,
      suggested_pipeline_id,
      suggested_stage_id,
      suggested_stage_name,
      suggested_reason,
      confidence: aiResult.confidence || 0,
      // Context for UI
      current_stage_name: currentStageName,
      current_stage_id: currentStageId,
      lead_id: conv.lead?.id || null,
    };

    // 7. Log to ai_interactions (audit)
    const { data: interactionData } = await supabase.from("ai_interactions").insert({
      organization_id,
      agent_name: "inbox-assistant",
      interaction_type: "conversation_analysis",
      input_data: {
        conversation_id,
        lead_id: conv.lead?.id || null,
        ai_mode: conv.ai_mode || "assisted",
        messages_count: messages.length,
      },
      output_data: finalResult,
      status: "completed",
    }).select("id").single();

    // Include interaction ID for linking to ai_stage_actions
    finalResult.ai_interaction_id = interactionData?.id || null;

    return new Response(JSON.stringify(finalResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ai-analyze-conversation error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
