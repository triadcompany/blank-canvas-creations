// whatsapp-webhook-v2: recebe eventos da Evolution para a nova tabela whatsapp_connections
// Mantém compatibilidade com o webhook legado (evolution-webhook) que continua processando
// mensagens em whatsapp_messages/whatsapp_threads. Aqui apenas atualizamos o estado da conexão.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // MESSAGES_UPSERT: o processamento real continua no evolution-webhook legado.
    // Aqui apenas respeitamos mirror_enabled como "kill switch" futuro.
    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("[wa-webhook-v2] error:", err);
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
});
