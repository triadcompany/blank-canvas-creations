// whatsapp-webhook-v2: recebe eventos da Evolution para a nova tabela whatsapp_connections.
// Atualiza o estado da conexão e espelha mensagens recebidas/enviadas no Inbox
// (tabelas `conversations` e `messages`) quando `mirror_enabled = true`.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .split("@")[0]
    .replace(/[\s\-\+\(\)]/g, "")
    .replace(/\D/g, "");
}

function extractMessageContent(msg: any): { body: string | null; messageType: string; mediaLabel: string | null } {
  const m = msg?.message || {};
  const text = m.conversation || m.extendedTextMessage?.text || null;
  const isImage = !!m.imageMessage;
  const isVideo = !!m.videoMessage;
  const isAudio = !!m.audioMessage;
  const isDocument = !!m.documentMessage;
  const isSticker = !!m.stickerMessage;
  const caption =
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    null;
  const messageType = isAudio
    ? "audio"
    : isImage
    ? "image"
    : isVideo
    ? "video"
    : isDocument
    ? "document"
    : isSticker
    ? "sticker"
    : "text";
  const mediaLabel = isImage
    ? "📷 Foto"
    : isVideo
    ? "🎥 Vídeo"
    : isAudio
    ? "🎵 Áudio"
    : isDocument
    ? "📄 Documento"
    : isSticker
    ? "Sticker"
    : null;
  const body =
    text ||
    (caption ? `${mediaLabel ? `${mediaLabel} ` : ""}${caption}` : mediaLabel);
  return { body, messageType, mediaLabel };
}

async function handleMessagesUpsert(
  supabase: any,
  payload: any,
  conn: { id: string; organization_id: string; mirror_enabled: boolean },
  instanceName: string,
) {
  if (!conn.mirror_enabled) {
    console.log(`[wa-webhook-v2] mirror disabled for ${instanceName} — skipping messages`);
    return;
  }

  const data = payload?.data;
  const list = Array.isArray(data) ? data : data ? [data] : [];
  if (list.length === 0) return;

  for (const msg of list) {
    try {
      const isFromMe = msg?.key?.fromMe === true;
      const remoteJid = msg?.key?.remoteJid || "";
      const phone = normalizePhone(remoteJid);
      if (!phone) continue;

      const externalId = msg?.key?.id || null;
      const pushName = msg?.pushName || msg?.notifyName || null;
      const { body, messageType } = extractMessageContent(msg);
      if (!body) {
        console.log(`[wa-webhook-v2] empty message for ${phone} — skipping`);
        continue;
      }

      const now = new Date().toISOString();
      const preview = body.substring(0, 100);

      // ── Find or create conversation ──
      const { data: existingConv } = await supabase
        .from("conversations")
        .select("id, unread_count, contact_name, contact_name_source")
        .eq("organization_id", conn.organization_id)
        .eq("instance_name", instanceName)
        .eq("contact_phone", phone)
        .maybeSingle();

      let conversationId: string | null = existingConv?.id || null;

      if (existingConv) {
        const update: Record<string, unknown> = {
          last_message_at: now,
          last_message_preview: preview,
        };
        if (!isFromMe) {
          update.unread_count = (existingConv.unread_count || 0) + 1;
        }
        const currentName = existingConv.contact_name || "";
        const isPlaceholder = !currentName || currentName === phone;
        if (pushName && (isPlaceholder || existingConv.contact_name_source === "whatsapp")) {
          update.contact_name = pushName;
          update.contact_name_source = "whatsapp";
        }
        await supabase.from("conversations").update(update).eq("id", existingConv.id);
      } else {
        const { data: newConv, error: convErr } = await supabase
          .from("conversations")
          .insert({
            organization_id: conn.organization_id,
            instance_name: instanceName,
            contact_phone: phone,
            contact_name: pushName || null,
            contact_name_source: pushName ? "whatsapp" : null,
            last_message_at: now,
            last_message_preview: preview,
            unread_count: isFromMe ? 0 : 1,
            assigned_to: null,
          })
          .select("id")
          .single();

        if (convErr) {
          console.error("[wa-webhook-v2] conversation insert error:", convErr);
          continue;
        }
        conversationId = newConv?.id || null;
      }

      if (!conversationId) continue;

      // ── Insert message (idempotent on external_message_id) ──
      if (externalId) {
        const { data: dupe } = await supabase
          .from("messages")
          .select("id")
          .eq("conversation_id", conversationId)
          .eq("external_message_id", externalId)
          .maybeSingle();
        if (dupe) continue;
      }

      const { error: msgErr } = await supabase.from("messages").insert({
        organization_id: conn.organization_id,
        conversation_id: conversationId,
        direction: isFromMe ? "outbound" : "inbound",
        body,
        external_message_id: externalId,
        message_type: messageType,
      });

      if (msgErr) {
        console.error("[wa-webhook-v2] message insert error:", msgErr);
      } else {
        console.log(
          `[wa-webhook-v2] message saved org=${conn.organization_id} conv=${conversationId} dir=${
            isFromMe ? "outbound" : "inbound"
          } type=${messageType}`,
        );
      }
    } catch (err) {
      console.error("[wa-webhook-v2] message loop error:", err);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const payload = await req.json().catch(() => ({} as any));
    const event: string = payload?.event || "";
    const instanceName: string | undefined =
      payload?.instance || payload?.instanceName || payload?.instance_name;

    console.log(`[wa-webhook-v2] event=${event} instance=${instanceName}`);

    if (!instanceName) return new Response("ok", { status: 200, headers: corsHeaders });

    const { data: conn } = await supabase
      .from("whatsapp_connections")
      .select("id, organization_id, status, connected_at, mirror_enabled, mirror_enabled_at, phone_number")
      .eq("instance_name", instanceName)
      .maybeSingle();

    if (!conn) {
      console.log(`[wa-webhook-v2] no connection for ${instanceName}`);
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    if (event === "connection.update" || event === "CONNECTION_UPDATE") {
      const state = payload?.data?.state || payload?.state;
      const phone = payload?.data?.wuid || payload?.data?.owner || null;

      if (state === "open") {
        const updates: Record<string, unknown> = {
          status: "connected",
          qr_code: null,
          last_connected_at: new Date().toISOString(),
        };
        if (!conn.connected_at) updates.connected_at = new Date().toISOString();
        if (!conn.mirror_enabled_at && conn.mirror_enabled) {
          updates.mirror_enabled_at = new Date().toISOString();
        }
        if (phone && !conn.phone_number) {
          updates.phone_number = String(phone).split("@")[0].replace(/\D/g, "");
        }
        await supabase.from("whatsapp_connections").update(updates).eq("id", conn.id);
      } else if (state === "close" || state === "closed") {
        await supabase
          .from("whatsapp_connections")
          .update({
            status: "disconnected",
            qr_code: null,
            last_disconnected_at: new Date().toISOString(),
          })
          .eq("id", conn.id);
      }
    }

    if (event === "messages.upsert" || event === "MESSAGES_UPSERT") {
      await handleMessagesUpsert(supabase, payload, conn, instanceName);
    }

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("[wa-webhook-v2] error:", err);
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
});
