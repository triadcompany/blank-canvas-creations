import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type QrFormat = "data_url" | "base64" | "text" | "url" | null;

function detectQrFormat(raw: string | null): { qr_code_data: string | null; qr_format: QrFormat } {
  if (!raw) return { qr_code_data: null, qr_format: null };
  if (raw.startsWith("data:image")) return { qr_code_data: raw, qr_format: "data_url" };
  if (raw.startsWith("http://") || raw.startsWith("https://")) return { qr_code_data: raw, qr_format: "url" };
  if (/^[A-Za-z0-9+/=]{50,}$/.test(raw.replace(/\s/g, ""))) return { qr_code_data: raw, qr_format: "base64" };
  if (raw.length > 10) return { qr_code_data: raw, qr_format: "text" };
  return { qr_code_data: null, qr_format: null };
}

function extractQrFromResponse(data: Record<string, unknown>): string | null {
  const candidates = [
    (data as any)?.base64,
    (data as any)?.qrcode?.base64,
    (data as any)?.qrcode?.pairingCode,
    (data as any)?.qrcode,
    (data as any)?.instance?.qrcode?.base64,
    (data as any)?.instance?.qrcode,
    (data as any)?.pairingCode,
    (data as any)?.code,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 10) return c;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");
    const evolutionBaseUrl = Deno.env.get("EVOLUTION_BASE_URL");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (!evolutionApiKey || !evolutionBaseUrl) {
      return respond({ ok: false, status: "error", qr_code_data: null, qr_format: null, message: "Secrets não configurados" }, 500);
    }

    const { organization_id } = await req.json();
    if (!organization_id) {
      return respond({ ok: false, status: "error", qr_code_data: null, qr_format: null, message: "organization_id obrigatório" }, 400);
    }

    console.log(`[evolution-qr] === START === org=${organization_id}`);

    const { data: integration, error } = await supabase
      .from("whatsapp_integrations")
      .select("instance_name, status")
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (error || !integration) {
      return respond({ ok: false, status: "error", qr_code_data: null, qr_format: null, message: "Integração não encontrada" }, 404);
    }

    console.log(`[evolution-qr] Instance: ${integration.instance_name} status: ${integration.status}`);

    if (integration.status === "connected") {
      return respond({ ok: true, status: "connected", qr_code_data: null, qr_format: null, message: "Já conectado" });
    }

    let rawQr: string | null = null;
    let connected = false;

    for (let i = 1; i <= 10; i++) {
      const url = `${evolutionBaseUrl}/instance/connect/${integration.instance_name}`;
      console.log(`[evolution-qr] Attempt ${i}/10: GET ${url}`);

      try {
        const r = await fetch(url, { method: "GET", headers: { apikey: evolutionApiKey } });
        const rText = await r.text();
        console.log(`[evolution-qr] Attempt ${i}: HTTP ${r.status} | body: ${rText.substring(0, 500)}`);

        if (r.ok) {
          const rData = JSON.parse(rText);
          if ((rData as any)?.instance?.state === "open" || (rData as any)?.state === "open") {
            connected = true; break;
          }
          const q = extractQrFromResponse(rData);
          if (q) { rawQr = q; console.log(`[evolution-qr] QR on attempt ${i} (len=${q.length})`); break; }
          else { console.log(`[evolution-qr] Attempt ${i}: no QR. Keys: ${JSON.stringify(Object.keys(rData))}`); }
        }
      } catch (err) {
        console.error(`[evolution-qr] Attempt ${i} error:`, err);
      }

      if (i < 10) await sleep(2000);
    }

    if (connected) {
      await supabase.from("whatsapp_integrations").update({
        status: "connected", qr_code_data: null,
        connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("organization_id", organization_id);

      return respond({ ok: true, status: "connected", qr_code_data: null, qr_format: null, message: "WhatsApp conectado!" });
    }

    const { qr_code_data, qr_format } = detectQrFormat(rawQr);

    if (!qr_code_data) {
      console.log("[evolution-qr] QR not available after 10 attempts");
      return respond({ ok: false, status: "qr_pending", qr_code_data: null, qr_format: null, message: "QR não disponível. Tente novamente em alguns segundos." }, 408);
    }

    console.log(`[evolution-qr] Saving QR format=${qr_format} len=${qr_code_data.length}`);
    await supabase.from("whatsapp_integrations").update({
      qr_code_data, status: "qr_pending", updated_at: new Date().toISOString(),
    }).eq("organization_id", organization_id);

    return respond({ ok: true, status: "qr_pending", qr_code_data, qr_format, message: "QR atualizado" });
  } catch (err) {
    console.error("[evolution-qr] Unhandled:", err);
    return respond({ ok: false, status: "error", qr_code_data: null, qr_format: null, message: String(err) }, 500);
  }
});
