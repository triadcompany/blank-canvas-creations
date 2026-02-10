import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    // ── Auth: validate caller ──
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return respond({ error: "Token de autenticação ausente" }, 401);
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return respond({ error: "Usuário não autenticado" }, 401);
    }

    // ── Parse input ──
    const { organization_id, thread_id, text } = await req.json();

    if (!organization_id || !thread_id || !text) {
      return respond({ error: "organization_id, thread_id e text são obrigatórios" }, 400);
    }

    // ── Validate user belongs to org ──
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (!profile) {
      return respond({ error: "Usuário não pertence a esta organização" }, 403);
    }

    // ── Get conversation ──
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, contact_phone, instance_name, organization_id")
      .eq("id", thread_id)
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (!conversation) {
      return respond({ error: "Conversa não encontrada" }, 404);
    }

    // ── Get WhatsApp integration ──
    const { data: integration } = await supabase
      .from("whatsapp_integrations")
      .select("instance_name, status")
      .eq("organization_id", organization_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!integration) {
      return respond({ error: "Integração WhatsApp não configurada" }, 400);
    }

    if (integration.status !== "connected") {
      return respond({ error: `WhatsApp não está conectado. Status: ${integration.status}` }, 400);
    }

    // ── Send via Evolution API ──
    const phone = conversation.contact_phone.replace(/\D/g, "");
    const sendRes = await fetch(
      `${evolutionBaseUrl}/message/sendText/${integration.instance_name}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: evolutionApiKey,
        },
        body: JSON.stringify({ number: phone, text }),
      }
    );

    const sendData = await sendRes.json();
    const now = new Date().toISOString();

    if (!sendRes.ok) {
      console.error("[whatsapp-send] Evolution error:", sendData);

      // Save failed message
      await supabase.from("messages").insert({
        organization_id,
        conversation_id: thread_id,
        direction: "outbound",
        body: text,
      });

      return respond({ error: "Erro ao enviar mensagem", details: sendData }, 400);
    }

    // ── Save outbound message ──
    await supabase.from("messages").insert({
      organization_id,
      conversation_id: thread_id,
      direction: "outbound",
      body: text,
    });

    // ── Update conversation.last_message_at ──
    await supabase
      .from("conversations")
      .update({ last_message_at: now })
      .eq("id", thread_id);

    console.log(`[whatsapp-send] Sent to ${phone} in conversation ${thread_id}`);

    return respond({ ok: true });
  } catch (err) {
    console.error("[whatsapp-send] Error:", err);
    return respond({ error: String(err) }, 500);
  }
});
