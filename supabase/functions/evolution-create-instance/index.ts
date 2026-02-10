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
  // Check if it looks like base64 (long alphanumeric string)
  if (/^[A-Za-z0-9+/=]{50,}$/.test(raw.replace(/\s/g, ""))) return { qr_code_data: raw, qr_format: "base64" };
  // Fallback: could be a text code for QR generation
  if (raw.length > 10) return { qr_code_data: raw, qr_format: "text" };
  return { qr_code_data: null, qr_format: null };
}

function extractQrFromResponse(data: Record<string, unknown>): string | null {
  // Try all known Evolution API QR fields
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

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 10) {
      return candidate;
    }
  }
  return null;
}

function isConnectedState(data: Record<string, unknown>): boolean {
  return (
    (data as any)?.instance?.state === "open" ||
    (data as any)?.state === "open" ||
    (data as any)?.instance?.status === "open"
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");
    const evolutionBaseUrl = Deno.env.get("EVOLUTION_BASE_URL");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (!evolutionApiKey || !evolutionBaseUrl) {
      console.error("[evolution-create] Missing secrets");
      return respond({ ok: false, status: "error", qr_code_data: null, qr_format: null, message: "EVOLUTION_API_KEY ou EVOLUTION_BASE_URL não configurados" }, 500);
    }

    const { organization_id, instance_name } = await req.json();

    if (!organization_id || !instance_name) {
      return respond({ ok: false, status: "error", qr_code_data: null, qr_format: null, message: "organization_id e instance_name são obrigatórios" }, 400);
    }

    if (!/^[a-z0-9_-]{3,40}$/.test(instance_name)) {
      return respond({ ok: false, status: "error", qr_code_data: null, qr_format: null, message: "instance_name inválido" }, 400);
    }

    console.log(`[evolution-create] === START === org=${organization_id} instance=${instance_name}`);
    console.log(`[evolution-create] Base URL: ${evolutionBaseUrl}`);

    // ──── Step 1: Create instance ────
    const createUrl = `${evolutionBaseUrl}/instance/create`;
    console.log(`[evolution-create] Step 1: POST ${createUrl}`);

    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: evolutionApiKey },
      body: JSON.stringify({
        instanceName: instance_name,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        reject_call: false,
        webhook: {
          url: `${supabaseUrl}/functions/v1/evolution-webhook`,
          enabled: true,
          webhookByEvents: true,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
        },
      }),
    });

    const createStatus = createRes.status;
    const createText = await createRes.text();
    console.log(`[evolution-create] Step 1: HTTP ${createStatus} | body: ${createText.substring(0, 800)}`);

    let instanceExists = false;
    let rawQr: string | null = null;
    let connected = false;

    if (!createRes.ok) {
      if (createText.includes("already") || createText.includes("exists") || createText.includes("instance_already") || createStatus === 403) {
        console.log("[evolution-create] Instance already exists");
        instanceExists = true;
      } else {
        return respond({ ok: false, status: "error", qr_code_data: null, qr_format: null, message: `Erro ao criar instância (HTTP ${createStatus})`, debug: createText.substring(0, 300) }, 400);
      }
    } else {
      try {
        const createData = JSON.parse(createText);
        console.log(`[evolution-create] Create keys: ${JSON.stringify(Object.keys(createData))}`);

        if (isConnectedState(createData)) {
          connected = true;
        } else {
          rawQr = extractQrFromResponse(createData);
          if (rawQr) console.log(`[evolution-create] QR from create (len=${rawQr.length}, prefix=${rawQr.substring(0, 30)})`);
        }
      } catch {
        console.log("[evolution-create] Create response not JSON");
      }
    }

    // ──── Step 2: Connect/start session ────
    if (!connected && !rawQr) {
      const connectUrl = `${evolutionBaseUrl}/instance/connect/${instance_name}`;
      console.log(`[evolution-create] Step 2: GET ${connectUrl}`);

      const connectRes = await fetch(connectUrl, { method: "GET", headers: { apikey: evolutionApiKey } });
      const connectStatus = connectRes.status;
      const connectText = await connectRes.text();
      console.log(`[evolution-create] Step 2: HTTP ${connectStatus} | body: ${connectText.substring(0, 800)}`);

      if (connectRes.ok) {
        try {
          const connectData = JSON.parse(connectText);
          console.log(`[evolution-create] Connect keys: ${JSON.stringify(Object.keys(connectData))}`);

          if (isConnectedState(connectData)) {
            connected = true;
          } else {
            rawQr = extractQrFromResponse(connectData);
            if (rawQr) console.log(`[evolution-create] QR from connect (len=${rawQr.length}, prefix=${rawQr.substring(0, 30)})`);
          }
        } catch {
          console.log("[evolution-create] Connect response not JSON");
        }
      }
    }

    // ──── Step 3: Retry loop (10 × 2s = 20s max) ────
    if (!connected && !rawQr) {
      console.log("[evolution-create] Step 3: Retry loop (10 attempts × 2s)");

      for (let i = 1; i <= 10; i++) {
        await sleep(2000);
        const retryUrl = `${evolutionBaseUrl}/instance/connect/${instance_name}`;
        console.log(`[evolution-create] Retry ${i}/10: GET ${retryUrl}`);

        try {
          const r = await fetch(retryUrl, { method: "GET", headers: { apikey: evolutionApiKey } });
          const rText = await r.text();
          console.log(`[evolution-create] Retry ${i}: HTTP ${r.status} | body: ${rText.substring(0, 400)}`);

          if (r.ok) {
            const rData = JSON.parse(rText);
            if (isConnectedState(rData)) { connected = true; break; }
            const q = extractQrFromResponse(rData);
            if (q) { rawQr = q; console.log(`[evolution-create] QR on retry ${i} (len=${q.length})`); break; }
            else { console.log(`[evolution-create] Retry ${i}: no QR field found in keys: ${JSON.stringify(Object.keys(rData))}`); }
          }
        } catch (err) {
          console.error(`[evolution-create] Retry ${i} error:`, err);
        }
      }
    }

    // ──── Step 4: Persist & respond ────
    if (connected) {
      console.log("[evolution-create] RESULT: connected");
      await supabase.from("whatsapp_integrations").upsert({
        organization_id, provider: "evolution", instance_name,
        status: "connected", qr_code_data: null,
        connected_at: new Date().toISOString(), is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id" });

      return respond({ ok: true, status: "connected", qr_code_data: null, qr_format: null, message: "WhatsApp já está conectado" });
    }

    const { qr_code_data, qr_format } = detectQrFormat(rawQr);
    console.log(`[evolution-create] RESULT: qr_pending | qr_format=${qr_format} | qr_data=${qr_code_data ? `present (len=${qr_code_data.length})` : "null"}`);

    await supabase.from("whatsapp_integrations").upsert({
      organization_id, provider: "evolution", instance_name,
      status: "qr_pending", qr_code_data: qr_code_data,
      is_active: true, updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id" });

    if (!qr_code_data) {
      return respond({
        ok: false, status: "qr_pending", qr_code_data: null, qr_format: null,
        message: "Instância criada mas QR não disponível. Clique 'Atualizar QR' em alguns segundos.",
      });
    }

    return respond({ ok: true, status: "qr_pending", qr_code_data, qr_format, message: "QR Code gerado com sucesso" });
  } catch (err) {
    console.error("[evolution-create] Unhandled:", err);
    return respond({ ok: false, status: "error", qr_code_data: null, qr_format: null, message: String(err) }, 500);
  }
});
