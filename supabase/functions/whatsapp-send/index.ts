import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-clerk-user-id, x-clerk-org-id, x-organization-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Resolve the active Evolution instance for an organization.
// Prefers the new `whatsapp_connections` table; falls back to legacy `whatsapp_integrations`.
async function resolveInstance(supabase: any, organizationId: string): Promise<{
  instance_name: string;
  api_key: string | null;
} | null> {
  const { data: conn } = await supabase
    .from("whatsapp_connections")
    .select("instance_name, evolution_api_key, status")
    .eq("organization_id", organizationId)
    .eq("status", "connected")
    .maybeSingle();

  if (conn?.instance_name) {
    return { instance_name: conn.instance_name, api_key: conn.evolution_api_key || null };
  }

  const { data: legacy } = await supabase
    .from("whatsapp_integrations")
    .select("instance_name, status")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  if (legacy?.instance_name && legacy.status === "connected") {
    return { instance_name: legacy.instance_name, api_key: null };
  }

  return null;
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
      return respond({ error: "EVOLUTION_API_KEY ou EVOLUTION_BASE_URL não configurados" }, 500);
    }

    const payload = await req.json().catch(() => ({}));
    const {
      organization_id,
      thread_id,
      text,
      message_type,
      media_url,
      mime_type,
      filename,
      caption,
    } = payload || {};

    if (!organization_id || !thread_id) {
      return respond({ error: "organization_id e thread_id são obrigatórios" }, 400);
    }

    const kind: string = message_type || (media_url ? "media" : "text");
    if (kind === "text" && !text) {
      return respond({ error: "text é obrigatório para mensagens de texto" }, 400);
    }
    if (kind !== "text" && !media_url) {
      return respond({ error: "media_url é obrigatório para mensagens de mídia" }, 400);
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

    // ── Resolve instance from new or legacy table ──
    const instance = await resolveInstance(supabase, organization_id);
    if (!instance) {
      return respond({ error: "WhatsApp não está conectado para esta organização" }, 400);
    }

    const apiKey = instance.api_key || evolutionApiKey;
    const phone = conversation.contact_phone.replace(/\D/g, "");

    // ── Build Evolution request ──
    let endpoint = "";
    let body: Record<string, unknown> = {};

    if (kind === "text") {
      endpoint = `${evolutionBaseUrl}/message/sendText/${instance.instance_name}`;
      body = { number: phone, text };
    } else if (kind === "image" || kind === "video" || kind === "document") {
      endpoint = `${evolutionBaseUrl}/message/sendMedia/${instance.instance_name}`;
      body = {
        number: phone,
        mediatype: kind,
        media: media_url,
        ...(caption ? { caption } : {}),
        ...(kind === "document" && filename ? { fileName: filename } : {}),
        ...(mime_type ? { mimetype: mime_type } : {}),
      };
    } else if (kind === "audio") {
      endpoint = `${evolutionBaseUrl}/message/sendWhatsAppAudio/${instance.instance_name}`;
      body = { number: phone, audio: media_url };
    } else {
      return respond({ error: `message_type inválido: ${kind}` }, 400);
    }

    const sendRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify(body),
    });

    const sendData = await sendRes.json().catch(() => ({}));
    const now = new Date().toISOString();

    if (!sendRes.ok) {
      console.error("[whatsapp-send] Evolution error:", sendData);
      return respond({ error: "Erro ao enviar mensagem", details: sendData }, 400);
    }

    const externalId = sendData?.key?.id || sendData?.messageId || null;

    const messageBody =
      kind === "text"
        ? text
        : caption ||
          (kind === "image"
            ? "📷 Foto"
            : kind === "video"
            ? "🎥 Vídeo"
            : kind === "audio"
            ? "🎵 Áudio"
            : "📄 Documento");
    const preview = String(messageBody).substring(0, 100);

    // ── Save outbound message ──
    await supabase.from("messages").insert({
      organization_id,
      conversation_id: thread_id,
      direction: "outbound",
      body: messageBody,
      external_message_id: externalId,
      message_type: kind === "text" ? "text" : kind,
      media_url: kind === "text" ? null : media_url,
      mime_type: mime_type || null,
    });

    // ── Update conversation ──
    await supabase
      .from("conversations")
      .update({ last_message_at: now, last_message_preview: preview })
      .eq("id", thread_id);

    console.log(
      `[whatsapp-send] kind=${kind} to=${phone} conv=${thread_id} instance=${instance.instance_name}`,
    );

    return respond({ ok: true, external_message_id: externalId });
  } catch (err) {
    console.error("[whatsapp-send] Error:", err);
    return respond({ error: String(err) }, 500);
  }
});
