// whatsapp-status: consulta status da conexão (DB + live Evolution opcional)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-clerk-user-id",
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evoUrl = Deno.env.get("EVOLUTION_BASE_URL");
    const evoKey = Deno.env.get("EVOLUTION_API_KEY");

    const supabase = createClient(supabaseUrl, serviceKey);
    const { organization_id, refresh_qr } = await req.json();

    if (!organization_id) return respond({ ok: false, error: "organization_id obrigatório" }, 400);

    const { data: conn } = await supabase
      .from("whatsapp_connections")
      .select("*")
      .eq("organization_id", organization_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conn) {
      return respond({ ok: true, status: "not_configured", connection: null });
    }

    // Defesa: garantir que pertence à org pedida
    if (conn.organization_id !== organization_id) {
      return respond({ ok: true, status: "not_configured", connection: null });
    }

    // Live check Evolution
    if (evoUrl && evoKey && conn.instance_name) {
      try {
        const r = await fetch(`${evoUrl}/instance/connectionState/${conn.instance_name}`, {
          method: "GET",
          headers: { apikey: evoKey },
        });
        const t = await r.text();

        if (r.ok) {
          const d = JSON.parse(t);
          const state = d?.instance?.state || d?.state || null;
          const phone = d?.instance?.owner || d?.instance?.profileName || null;

          if (state === "open") {
            // primeira vez conectado
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
              updates.phone_number = String(phone).replace(/\D/g, "");
            }

            const { data: updated } = await supabase
              .from("whatsapp_connections")
              .update(updates)
              .eq("id", conn.id)
              .select()
              .single();

            return respond({ ok: true, status: "connected", connection: updated || { ...conn, ...updates } });
          }

          if (state === "close" || state === "closed") {
            if (conn.status !== "disconnected") {
              await supabase
                .from("whatsapp_connections")
                .update({
                  status: "disconnected",
                  last_disconnected_at: new Date().toISOString(),
                  qr_code: null,
                })
                .eq("id", conn.id);
            }
            return respond({ ok: true, status: "disconnected", connection: { ...conn, status: "disconnected" } });
          }

          // pairing/connecting → renovar QR se pedido
          if (refresh_qr && (state === "connecting" || state === "qrcode" || !state)) {
            try {
              const cr = await fetch(`${evoUrl}/instance/connect/${conn.instance_name}`, {
                method: "GET",
                headers: { apikey: evoKey },
              });
              const ct = await cr.text();
              if (cr.ok) {
                const cd = JSON.parse(ct);
                const newQr = cd?.qrcode?.base64 || cd?.base64 || cd?.code || null;
                if (newQr) {
                  await supabase
                    .from("whatsapp_connections")
                    .update({ qr_code: newQr, status: "connecting" })
                    .eq("id", conn.id);
                  return respond({
                    ok: true,
                    status: "connecting",
                    connection: { ...conn, qr_code: newQr, status: "connecting" },
                  });
                }
              }
            } catch (_) { /* ignore */ }
          }
        } else if (r.status === 404) {
          // instância não existe mais
          if (conn.status !== "disconnected") {
            await supabase
              .from("whatsapp_connections")
              .update({ status: "disconnected", last_disconnected_at: new Date().toISOString() })
              .eq("id", conn.id);
          }
          return respond({ ok: true, status: "disconnected", connection: { ...conn, status: "disconnected" } });
        }
      } catch (e) {
        console.error("[whatsapp-status] live check error:", e);
      }
    }

    return respond({ ok: true, status: conn.status, connection: conn });
  } catch (err) {
    console.error("[whatsapp-status] Unhandled:", err);
    return respond({ ok: false, error: String(err) }, 500);
  }
});
