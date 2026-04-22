// whatsapp-connect: cria instância na Evolution e retorna QR code
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

function extractQr(data: any): string | null {
  const candidates = [
    data?.qrcode?.base64,
    data?.base64,
    data?.qrcode?.code,
    data?.qrcode,
    data?.instance?.qrcode?.base64,
    data?.code,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 10) return c;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evoUrl = Deno.env.get("EVOLUTION_BASE_URL");
    const evoKey = Deno.env.get("EVOLUTION_API_KEY");

    if (!evoUrl || !evoKey) {
      return respond({ ok: false, error: "EVOLUTION_BASE_URL/EVOLUTION_API_KEY não configurados" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const clerkUserId = req.headers.get("x-clerk-user-id");
    const { organization_id } = await req.json();

    if (!organization_id) return respond({ ok: false, error: "organization_id obrigatório" }, 400);
    if (!clerkUserId) return respond({ ok: false, error: "x-clerk-user-id header ausente" }, 401);

    // Validar admin da org
    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("clerk_user_id", clerkUserId)
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (!profile) return respond({ ok: false, error: "Usuário não pertence à organização" }, 403);

    // Verifica se já existe conexão ativa
    const { data: existing } = await supabase
      .from("whatsapp_connections")
      .select("id, status, instance_name")
      .eq("organization_id", organization_id)
      .in("status", ["connected", "connecting"])
      .maybeSingle();

    if (existing && existing.status === "connected") {
      return respond({ ok: false, error: "Já existe WhatsApp conectado para esta organização" }, 409);
    }

    // Se existir uma "connecting" antiga, deleta na Evolution e reaproveita
    if (existing && existing.status === "connecting") {
      try {
        await fetch(`${evoUrl}/instance/delete/${existing.instance_name}`, {
          method: "DELETE",
          headers: { apikey: evoKey },
        });
      } catch (_) { /* ignore */ }
      await supabase.from("whatsapp_connections").delete().eq("id", existing.id);
    }

    // Gerar instance_name único
    const instanceName = `autolead_${organization_id.replace(/-/g, "")}_${Date.now()}`;
    const webhookUrl = `${supabaseUrl}/functions/v1/whatsapp-webhook-v2`;

    console.log(`[whatsapp-connect] Creating instance: ${instanceName}`);

    const createRes = await fetch(`${evoUrl}/instance/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: evoKey },
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
        webhook: {
          url: webhookUrl,
          byEvents: false,
          base64: true,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        },
      }),
    });

    const createText = await createRes.text();
    console.log(`[whatsapp-connect] Evolution response: ${createRes.status} | ${createText.substring(0, 400)}`);

    if (!createRes.ok) {
      return respond({ ok: false, error: `Evolution API erro ${createRes.status}: ${createText.substring(0, 300)}` }, 500);
    }

    const createData = JSON.parse(createText);
    const instanceApiKey = createData?.hash?.apikey || createData?.hash || null;
    let qrCode = extractQr(createData);

    // Se QR não veio na criação, faz GET /instance/connect
    if (!qrCode) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const r = await fetch(`${evoUrl}/instance/connect/${instanceName}`, {
          method: "GET",
          headers: { apikey: evoKey },
        });
        const t = await r.text();
        if (r.ok) {
          const d = JSON.parse(t);
          qrCode = extractQr(d);
        }
      } catch (e) {
        console.error("[whatsapp-connect] connect call failed:", e);
      }
    }

    // Salvar no banco
    const { data: inserted, error: insertErr } = await supabase
      .from("whatsapp_connections")
      .insert({
        organization_id,
        instance_name: instanceName,
        status: "connecting",
        qr_code: qrCode,
        evolution_api_key: instanceApiKey,
        created_by_clerk_user_id: clerkUserId,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("[whatsapp-connect] Insert failed:", insertErr);
      // tenta limpar instância órfã
      await fetch(`${evoUrl}/instance/delete/${instanceName}`, {
        method: "DELETE",
        headers: { apikey: evoKey },
      }).catch(() => {});
      return respond({ ok: false, error: insertErr.message }, 500);
    }

    return respond({
      ok: true,
      connection: inserted,
      qr_code: qrCode,
      instance_name: instanceName,
    });
  } catch (err) {
    console.error("[whatsapp-connect] Unhandled:", err);
    return respond({ ok: false, error: String(err) }, 500);
  }
});
