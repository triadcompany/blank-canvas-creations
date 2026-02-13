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
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 10) return candidate;
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

/** Generate a cryptographically random token for webhook auth */
function generateWebhookToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function buildWebhookUrl(supabaseUrl: string, token: string): string {
  return `${supabaseUrl}/functions/v1/evolution-webhook?token=${encodeURIComponent(token)}`;
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

    // ──── Step 0: Ensure org exists in organizations table (FK requirement) ────
    {
      const { data: orgRow } = await supabase
        .from("organizations")
        .select("id")
        .eq("id", organization_id)
        .maybeSingle();

      if (!orgRow) {
        // Org exists in clerk_organizations but not in organizations — create it
        const { data: clerkOrg } = await supabase
          .from("clerk_organizations")
          .select("name")
          .eq("id", organization_id)
          .maybeSingle();

        const orgName = clerkOrg?.name || "Organização";
        console.log(`[evolution-create] Creating missing organizations row for ${organization_id} (${orgName})`);

        const { error: orgInsertErr } = await supabase
          .from("organizations")
          .insert({ id: organization_id, name: orgName });

        if (orgInsertErr) {
          console.error("[evolution-create] Failed to create org row:", orgInsertErr);
          return respond({ ok: false, status: "error", qr_code_data: null, qr_format: null, message: `Erro ao criar organização: ${orgInsertErr.message}` }, 500);
        }
      }
    }

    // ──── Generate per-org webhook token ────
    const webhookToken = generateWebhookToken();
    const webhookUrl = buildWebhookUrl(supabaseUrl, webhookToken);
    console.log(`[evolution-create] Generated webhook token (len=${webhookToken.length}), URL: ${webhookUrl.substring(0, 80)}...`);

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
          url: webhookUrl,
          enabled: true,
          webhookByEvents: true,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED", "MESSAGES_UPDATE"],
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
        console.log("[evolution-create] Instance already exists — will update webhook");
        instanceExists = true;

        // Update webhook URL on existing instance
        await updateEvolutionWebhook(evolutionBaseUrl, evolutionApiKey, instance_name, webhookUrl);
      } else {
        return respond({ ok: false, status: "error", qr_code_data: null, qr_format: null, message: `Erro ao criar instância (HTTP ${createStatus})`, debug: createText.substring(0, 300) }, 400);
      }
    } else {
      try {
        const createData = JSON.parse(createText);
        if (isConnectedState(createData)) {
          connected = true;
        } else {
          rawQr = extractQrFromResponse(createData);
        }
      } catch { /* not JSON */ }
    }

    // ──── Step 2: Connect/start session ────
    if (!connected && !rawQr) {
      const connectUrl = `${evolutionBaseUrl}/instance/connect/${instance_name}`;
      console.log(`[evolution-create] Step 2: GET ${connectUrl}`);

      const connectRes = await fetch(connectUrl, { method: "GET", headers: { apikey: evolutionApiKey } });
      const connectText = await connectRes.text();
      console.log(`[evolution-create] Step 2: HTTP ${connectRes.status} | body: ${connectText.substring(0, 800)}`);

      if (connectRes.ok) {
        try {
          const connectData = JSON.parse(connectText);
          if (isConnectedState(connectData)) {
            connected = true;
          } else {
            rawQr = extractQrFromResponse(connectData);
          }
        } catch { /* not JSON */ }
      }
    }

    // ──── Step 3: Retry loop (10 × 2s = 20s max) ────
    if (!connected && !rawQr) {
      console.log("[evolution-create] Step 3: Retry loop (10 attempts × 2s)");
      for (let i = 1; i <= 10; i++) {
        await sleep(2000);
        try {
          const r = await fetch(`${evolutionBaseUrl}/instance/connect/${instance_name}`, { method: "GET", headers: { apikey: evolutionApiKey } });
          const rText = await r.text();
          if (r.ok) {
            const rData = JSON.parse(rText);
            if (isConnectedState(rData)) { connected = true; break; }
            const q = extractQrFromResponse(rData);
            if (q) { rawQr = q; break; }
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
        webhook_token: webhookToken,
        connected_at: new Date().toISOString(), is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id" });

      return respond({ ok: true, status: "connected", qr_code_data: null, qr_format: null, message: "WhatsApp já está conectado" });
    }

    const { qr_code_data, qr_format } = detectQrFormat(rawQr);

    await supabase.from("whatsapp_integrations").upsert({
      organization_id, provider: "evolution", instance_name,
      status: "qr_pending", qr_code_data,
      webhook_token: webhookToken,
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

/** Update the webhook URL on an existing Evolution instance */
async function updateEvolutionWebhook(baseUrl: string, apiKey: string, instanceName: string, webhookUrl: string) {
  const endpoints = [
    { url: `${baseUrl}/webhook/set/${instanceName}`, method: "POST" },
    { url: `${baseUrl}/instance/update/${instanceName}`, method: "PUT" },
  ];

  for (const ep of endpoints) {
    try {
      console.log(`[evolution-create] Updating webhook: ${ep.method} ${ep.url}`);
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({
          webhook: {
            url: webhookUrl,
            enabled: true,
            webhookByEvents: true,
            events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED", "MESSAGES_UPDATE"],
          },
        }),
      });
      const text = await res.text();
      console.log(`[evolution-create] Webhook update ${ep.method}: HTTP ${res.status} | ${text.substring(0, 200)}`);
      if (res.ok) {
        console.log("[evolution-create] Webhook URL updated successfully");
        return;
      }
    } catch (err) {
      console.error(`[evolution-create] Webhook update error (${ep.method}):`, err);
    }
  }
  console.warn("[evolution-create] Could not update webhook via API — will rely on auto-repair");
}
