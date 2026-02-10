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
      console.error("[evolution-qr] Missing secrets");
      return new Response(
        JSON.stringify({ error: "EVOLUTION_API_KEY ou EVOLUTION_BASE_URL não configurados" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { organization_id } = await req.json();

    if (!organization_id) {
      return new Response(
        JSON.stringify({ error: "organization_id é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[evolution-qr] === START === org=${organization_id}`);

    // Get integration
    const { data: integration, error } = await supabase
      .from("whatsapp_integrations")
      .select("instance_name, status")
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (error || !integration) {
      console.error("[evolution-qr] Integration not found:", error);
      return new Response(
        JSON.stringify({ error: "Integração não encontrada. Crie uma instância primeiro." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[evolution-qr] Instance: ${integration.instance_name}, current status: ${integration.status}`);

    if (integration.status === "connected") {
      return new Response(
        JSON.stringify({ connected: true, message: "WhatsApp já está conectado" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Retry loop: try up to 10 times with 3s interval
    let qrCode: string | null = null;
    let isConnected = false;

    for (let attempt = 1; attempt <= 10; attempt++) {
      const connectUrl = `${evolutionBaseUrl}/instance/connect/${integration.instance_name}`;
      console.log(`[evolution-qr] Attempt ${attempt}/10: GET ${connectUrl}`);

      try {
        const qrRes = await fetch(connectUrl, {
          method: "GET",
          headers: { apikey: evolutionApiKey },
        });

        const qrStatus = qrRes.status;
        const qrText = await qrRes.text();
        console.log(`[evolution-qr] Attempt ${attempt} response: status=${qrStatus} body=${qrText.substring(0, 500)}`);

        if (qrRes.ok) {
          const qrData = JSON.parse(qrText);
          console.log(`[evolution-qr] Response keys: ${Object.keys(qrData).join(", ")}`);

          // Check if already connected
          if (qrData?.instance?.state === "open" || qrData?.state === "open") {
            isConnected = true;
            console.log(`[evolution-qr] Connected on attempt ${attempt}`);
            break;
          }

          // Extract QR
          const extractedQr = qrData?.base64 || qrData?.qrcode?.base64 || qrData?.instance?.qrcode || null;
          if (extractedQr) {
            qrCode = extractedQr;
            console.log(`[evolution-qr] QR found on attempt ${attempt} (length=${qrCode.length})`);
            break;
          }
        }
      } catch (err) {
        console.error(`[evolution-qr] Attempt ${attempt} error:`, err);
      }

      if (attempt < 10) {
        console.log(`[evolution-qr] No QR yet, waiting 3s...`);
        await sleep(3000);
      }
    }

    if (isConnected) {
      await supabase
        .from("whatsapp_integrations")
        .update({
          status: "connected",
          qr_code_data: null,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", organization_id);

      return new Response(
        JSON.stringify({ connected: true, message: "WhatsApp conectado!" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!qrCode) {
      console.log("[evolution-qr] QR not available after 10 attempts");
      return new Response(
        JSON.stringify({
          error: "QR não disponível ainda. A instância pode estar inicializando — tente novamente em alguns segundos.",
          status: "qr_pending",
        }),
        { status: 408, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize QR format
    if (!qrCode.startsWith("data:")) {
      qrCode = `data:image/png;base64,${qrCode}`;
    }

    console.log(`[evolution-qr] Saving QR (length=${qrCode.length})`);

    await supabase
      .from("whatsapp_integrations")
      .update({
        qr_code_data: qrCode,
        status: "qr_pending",
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organization_id);

    return new Response(
      JSON.stringify({ qr_code: qrCode, status: "qr_pending" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[evolution-qr] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
