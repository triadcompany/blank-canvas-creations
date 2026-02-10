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
      .select("*, lead:leads!lead_id(id, name, stage_id, stage:pipeline_stages!stage_id(name))")
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

    // 3. Build context for GPT
    const contactName = conv.contact_name || conv.contact_phone;
    const leadInfo = conv.lead
      ? `Lead vinculado: "${conv.lead.name}", etapa atual: "${conv.lead.stage?.name || 'N/A'}"`
      : "Sem lead vinculado.";
    const assignedInfo = conv.assigned_to ? `Responsável atribuído: sim` : `Sem responsável atribuído.`;

    const chatHistory = messages.map((m: any) =>
      `[${m.direction === 'inbound' ? 'CLIENTE' : 'ATENDENTE'}] ${m.body}`
    ).join("\n");

    const systemPrompt = `Você é um assistente de vendas comercial inteligente. Sua função é analisar conversas de WhatsApp e sugerir a melhor resposta para o atendente humano.

CONTEXTO:
- Contato: ${contactName}
- ${leadInfo}
- ${assignedInfo}

REGRAS:
- Sugira UMA resposta curta e natural (como se fosse por WhatsApp)
- Identifique a intenção do cliente (interest, question, objection, complaint, closing, greeting, other)
- Sugira ações possíveis (move_stage, qualify_lead, schedule_followup) mas NUNCA execute
- Seja direto e comercial, focado em avançar a negociação
- Responda em português brasileiro

Responda EXATAMENTE neste formato JSON:
{
  "intent": "string",
  "summary": "resumo curto da conversa em 1 frase",
  "suggested_reply": "texto da resposta sugerida",
  "suggested_actions": ["ação1", "ação2"],
  "confidence": 0.0
}`;

    // 4. Call OpenAI
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
        max_tokens: 500,
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
    let aiResult;
    try {
      // Extract JSON from possible markdown code blocks
      const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawContent];
      aiResult = JSON.parse(jsonMatch[1].trim());
    } catch {
      aiResult = {
        intent: "unknown",
        summary: "Não foi possível analisar",
        suggested_reply: rawContent,
        suggested_actions: [],
        confidence: 0.3,
      };
    }

    // 5. Log to ai_interactions (audit)
    await supabase.from("ai_interactions").insert({
      organization_id,
      agent_name: "inbox-assistant",
      interaction_type: "conversation_analysis",
      input_data: {
        conversation_id,
        lead_id: conv.lead?.id || null,
        ai_mode: conv.ai_mode || "assisted",
        messages_count: messages.length,
      },
      output_data: aiResult,
      status: "completed",
    });

    return new Response(JSON.stringify(aiResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ai-analyze-conversation error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
