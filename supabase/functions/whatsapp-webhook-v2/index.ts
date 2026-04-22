// whatsapp-webhook-v2: recebe eventos da Evolution para a nova tabela whatsapp_connections.
// Atualiza o estado da conexão e espelha mensagens recebidas/enviadas no Inbox
// (tabelas `conversations` e `messages`) quando `mirror_enabled = true`.
// Para mensagens com mídia, baixa o conteúdo da Evolution e persiste no bucket `chat-media`.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVOLUTION_BASE_URL = Deno.env.get("EVOLUTION_BASE_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";
const MEDIA_BUCKET = "chat-media";

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .split("@")[0]
    .replace(/[\s\-\+\(\)]/g, "")
    .replace(/\D/g, "");
}

type MediaInfo = {
  body: string | null;
  messageType: string;
  mediaLabel: string | null;
  mimeType: string | null;
  fileName: string | null;
  hasMedia: boolean;
};

function extractMessageContent(msg: any): MediaInfo {
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
  const mediaNode =
    m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.stickerMessage;
  const mimeType = mediaNode?.mimetype || null;
  const fileName = m.documentMessage?.fileName || m.documentMessage?.title || null;
  const hasMedia = isImage || isVideo || isAudio || isDocument;
  return { body, messageType, mediaLabel, mimeType, fileName, hasMedia };
}

function pickExtension(messageType: string, mimeType: string | null, fileName: string | null): string {
  if (fileName && fileName.includes(".")) {
    const ext = fileName.split(".").pop();
    if (ext && ext.length <= 6) return ext.toLowerCase();
  }
  if (mimeType) {
    const sub = mimeType.split("/")[1]?.split(";")[0];
    if (sub) {
      if (sub === "jpeg") return "jpg";
      if (sub === "ogg") return "ogg";
      if (sub === "mp4") return "mp4";
      if (sub === "webm") return "webm";
      if (sub === "pdf") return "pdf";
      if (sub === "png") return "png";
      if (sub === "webp") return "webp";
      return sub;
    }
  }
  return messageType === "image"
    ? "jpg"
    : messageType === "video"
    ? "mp4"
    : messageType === "audio"
    ? "ogg"
    : "bin";
}

// Download media from Evolution, upload to Supabase Storage, return public URL.
async function downloadAndStoreMedia(
  supabase: any,
  instanceName: string,
  msg: any,
  info: MediaInfo,
  organizationId: string,
  conversationId: string,
): Promise<string | null> {
  if (!info.hasMedia) return null;
  if (!EVOLUTION_BASE_URL || !EVOLUTION_API_KEY) {
    console.warn("[wa-webhook-v2] Evolution env not set — skipping media download");
    return null;
  }

  try {
    const res = await fetch(
      `${EVOLUTION_BASE_URL}/chat/getBase64FromMediaMessage/${instanceName}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
        body: JSON.stringify({ message: { key: msg.key } }),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[wa-webhook-v2] media download failed status=${res.status} body=${errText.substring(0, 200)}`);
      return null;
    }

    const data = await res.json().catch(() => ({} as any));
    const base64: string | undefined = data?.base64 || data?.media || data?.file;
    if (!base64) {
      console.error("[wa-webhook-v2] media response missing base64", Object.keys(data || {}));
      return null;
    }

    const bytes = decodeBase64(base64);
    const mime = info.mimeType || data?.mimetype || null;
    const ext = pickExtension(info.messageType, mime, info.fileName);
    const ts = Date.now();
    const safeName = info.fileName ? info.fileName.replace(/[^a-zA-Z0-9._-]/g, "_") : `${ts}.${ext}`;
    const path = `${organizationId}/${conversationId}/${ts}_${safeName}`;

    const { error: uploadErr } = await supabase.storage.from(MEDIA_BUCKET).upload(path, bytes, {
      contentType: mime || "application/octet-stream",
      upsert: false,
    });

    if (uploadErr) {
      console.error("[wa-webhook-v2] storage upload error:", uploadErr);
      return null;
    }

    const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    return urlData?.publicUrl || null;
  } catch (err) {
    console.error("[wa-webhook-v2] downloadAndStoreMedia error:", err);
    return null;
  }
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
      const remoteJid: string = msg?.key?.remoteJid || "";
      const isGroup = remoteJid.endsWith("@g.us");
      // For groups: keep the group JID (without suffix) as conversation key
      const phone = isGroup
        ? remoteJid.replace("@g.us", "")
        : normalizePhone(remoteJid);
      if (!phone) continue;

      // Group sender info (only meaningful for inbound group messages)
      const participantJid: string = msg?.key?.participant || msg?.participant || "";
      const senderPhone = participantJid
        ? participantJid.replace("@s.whatsapp.net", "").replace("@c.us", "").replace(/\D/g, "")
        : (isFromMe ? "" : phone.replace(/\D/g, ""));
      const senderName = msg?.pushName || msg?.notifyName || null;

      const externalId = msg?.key?.id || null;
      const pushName = msg?.pushName || msg?.notifyName || null;
      const info = extractMessageContent(msg);
      if (!info.body) {
        console.log(`[wa-webhook-v2] empty message for ${phone} — skipping`);
        continue;
      }

      const now = new Date().toISOString();
      // For groups, prefix preview with sender name
      const previewBase = (isGroup && !isFromMe && (senderName || senderPhone))
        ? `${senderName || senderPhone}: ${info.body}`
        : info.body;
      const preview = previewBase.substring(0, 100);

      // ── Find or create conversation ──
      const { data: existingConv } = await supabase
        .from("conversations")
        .select("id, unread_count, contact_name, contact_name_source, profile_picture_url, profile_picture_updated_at")
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
        if (isGroup) {
          // Never use participant pushName as the group name.
          update.is_group = true;
          const groupSubject =
            (typeof body?.data?.subject === "string" && body.data.subject) ||
            (typeof msg?.subject === "string" && msg.subject) ||
            null;
          if (groupSubject) {
            update.group_name = groupSubject;
            update.contact_name = groupSubject;
            update.contact_name_source = "whatsapp_group";
          } else if (
            !existingConv.contact_name ||
            existingConv.contact_name_source === "whatsapp"
          ) {
            const fallback = `Grupo (${phone.slice(-4)})`;
            update.contact_name = fallback;
            update.contact_name_source = "group_fallback";
          }
        } else {
          const currentName = existingConv.contact_name || "";
          const isPlaceholder = !currentName || currentName === phone;
          if (pushName && (isPlaceholder || existingConv.contact_name_source === "whatsapp")) {
            update.contact_name = pushName;
            update.contact_name_source = "whatsapp";
          }
        }
        await supabase.from("conversations").update(update).eq("id", existingConv.id);

        // Refresh profile picture (only for individual conversations)
        if (!isFromMe && !isGroup) {
          const picUpdatedAt = existingConv.profile_picture_updated_at;
          const needsRefresh = !existingConv.profile_picture_url ||
            !picUpdatedAt ||
            (Date.now() - new Date(picUpdatedAt).getTime()) > 24 * 60 * 60 * 1000;
          if (needsRefresh) {
            fetchAndStoreProfilePicture(supabase, instanceName, remoteJid, existingConv.id)
              .catch((e) => console.error("[wa-webhook-v2] picture refresh error:", e));
          }
        }
      } else {
        const groupSubject = isGroup
          ? ((typeof body?.data?.subject === "string" && body.data.subject) ||
             (typeof msg?.subject === "string" && msg.subject) ||
             `Grupo (${phone.slice(-4)})`)
          : null;
        const { data: newConv, error: convErr } = await supabase
          .from("conversations")
          .insert({
            organization_id: conn.organization_id,
            instance_name: instanceName,
            contact_phone: phone,
            contact_name: isGroup ? groupSubject : (pushName || null),
            contact_name_source: isGroup ? "group_fallback" : (pushName ? "whatsapp" : null),
            last_message_at: now,
            last_message_preview: preview,
            unread_count: isFromMe ? 0 : 1,
            assigned_to: null,
            is_group: isGroup,
            group_name: isGroup ? groupSubject : null,
          })
          .select("id")
          .single();

        if (convErr) {
          console.error("[wa-webhook-v2] conversation insert error:", convErr);
          continue;
        }
        conversationId = newConv?.id || null;

        // Fetch profile picture for new conversation (background) — only for individuals
        if (conversationId && !isFromMe && !isGroup) {
          fetchAndStoreProfilePicture(supabase, instanceName, remoteJid, conversationId)
            .catch((e) => console.error("[wa-webhook-v2] picture fetch error:", e));
        }
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

      // ── Persist media if any ──
      let mediaUrl: string | null = null;
      if (info.hasMedia) {
        mediaUrl = await downloadAndStoreMedia(
          supabase,
          instanceName,
          msg,
          info,
          conn.organization_id,
          conversationId,
        );
      }

      const { error: msgErr } = await supabase.from("messages").insert({
        organization_id: conn.organization_id,
        conversation_id: conversationId,
        direction: isFromMe ? "outbound" : "inbound",
        body: info.body,
        external_message_id: externalId,
        message_type: info.messageType,
        media_url: mediaUrl,
        mime_type: info.mimeType,
        sender_name: !isFromMe ? (senderName || null) : null,
        sender_phone: !isFromMe ? (senderPhone || null) : null,
      });

      if (msgErr) {
        console.error("[wa-webhook-v2] message insert error:", msgErr);
      } else {
        console.log(
          `[wa-webhook-v2] message saved org=${conn.organization_id} conv=${conversationId} dir=${
            isFromMe ? "outbound" : "inbound"
          } type=${info.messageType} media=${mediaUrl ? "yes" : "no"}`,
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

// Fetch profile picture from Evolution API and save to conversations table
async function fetchAndStoreProfilePicture(
  supabase: any,
  instanceName: string,
  remoteJid: string,
  conversationId: string,
): Promise<void> {
  if (!EVOLUTION_BASE_URL || !EVOLUTION_API_KEY) return;
  try {
    const res = await fetch(`${EVOLUTION_BASE_URL}/chat/fetchProfilePictureUrl/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number: remoteJid }),
    });
    if (!res.ok) {
      console.warn(`[wa-webhook-v2] fetchProfilePictureUrl failed: ${res.status}`);
      return;
    }
    const data = await res.json().catch(() => ({}));
    const pictureUrl = data?.profilePictureUrl || data?.pictureUrl || data?.imgUrl || null;
    const updateData: Record<string, unknown> = {
      profile_picture_updated_at: new Date().toISOString(),
    };
    if (pictureUrl) updateData.profile_picture_url = pictureUrl;
    await supabase.from("conversations").update(updateData).eq("id", conversationId);
    console.log(`[wa-webhook-v2] profile picture ${pictureUrl ? "updated" : "checked"} for conv ${conversationId}`);
  } catch (e) {
    console.error("[wa-webhook-v2] fetchAndStoreProfilePicture error:", e);
  }
}
