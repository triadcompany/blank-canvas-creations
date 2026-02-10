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
      console.error("[evolution-create] Missing secrets: EVOLUTION_API_KEY or EVOLUTION_BASE_URL");
      return new Response(
        JSON.stringify({ error: "EVOLUTION_API_KEY ou EVOLUTION_BASE_URL não configurados" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { organization_id, instance_name } = await req.json();

    if (!organization_id || !instance_name) {
      return new Response(
        JSON.stringify({ error: "organization_id e instance_name são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!/^[a-z0-9_-]{3,40}$/.test(instance_name)) {
      return new Response(
        JSON.stringify({ error: "instance_name deve ter 3-40 caracteres, lowercase, apenas letras, números, - e _" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[evolution-create] === START === org=${organization_id} instance=${instance_name}`);
    console.log(`[evolution-create] Base URL: ${evolutionBaseUrl}`);

    // Step 1: Try to create the instance
    const createUrl = `${evolutionBaseUrl}/instance/create`;
    console.log(`[evolution-create] Step 1: POST ${createUrl}`);

    const createBody = {
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
    };

    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: evolutionApiKey },
      body: JSON.stringify(createBody),
    });

    const createStatus = createRes.status;
    const createText = await createRes.text();
    console.log(`[evolution-create] Step 1 response: status=${createStatus} body=${createText.substring(0, 1000)}`);

    let instanceAlreadyExists = false;

    if (!createRes.ok) {
      if (createText.includes("already") || createText.includes("exists") || createText.includes("instance_already")) {
        console.log("[evolution-create] Instance already exists, will try to connect");
        instanceAlreadyExists = true;
      } else {
        return new Response(
          JSON.stringify({ error: "Erro ao criar instância Evolution", details: createText }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Try to extract QR from creation response
    let qrCode: string | null = null;
    let isConnected = false;

    if (!instanceAlreadyExists) {
      try {
        const createData = JSON.parse(createText);
        console.log(`[evolution-create] Create response keys: ${Object.keys(createData).join(", ")}`);

        // Check for QR in create response
        qrCode = createData?.qrcode?.base64 || createData?.base64 || createData?.instance?.qrcode?.base64 || null;
        if (qrCode) {
          console.log(`[evolution-create] QR found in create response (length=${qrCode.length})`);
        }

        // Check if already open
        if (createData?.instance?.state === "open" || createData?.state === "open") {
          isConnected = true;
          console.log("[evolution-create] Instance already connected from creation");
        }
      } catch {
        console.log("[evolution-create] Could not parse create response as JSON");
      }
    }

    // Step 2: Call connect endpoint to start the session / get QR
    if (!isConnected && !qrCode) {
      const connectUrl = `${evolutionBaseUrl}/instance/connect/${instance_name}`;
      console.log(`[evolution-create] Step 2: GET ${connectUrl}`);

      const connectRes = await fetch(connectUrl, {
        method: "GET",
        headers: { apikey: evolutionApiKey },
      });

      const connectStatus = connectRes.status;
      const connectText = await connectRes.text();
      console.log(`[evolution-create] Step 2 response: status=${connectStatus} body=${connectText.substring(0, 1000)}`);

      if (connectRes.ok) {
        try {
          const connectData = JSON.parse(connectText);
          console.log(`[evolution-create] Connect response keys: ${Object.keys(connectData).join(", ")}`);

          if (connectData?.instance?.state === "open" || connectData?.state === "open") {
            isConnected = true;
            console.log("[evolution-create] Instance connected from connect endpoint");
          } else {
            qrCode = connectData?.base64 || connectData?.qrcode?.base64 || connectData?.instance?.qrcode || null;
            if (qrCode) {
              console.log(`[evolution-create] QR found from connect (length=${qrCode.length})`);
            }
          }
        } catch {
          console.log("[evolution-create] Could not parse connect response");
        }
      }
    }

    // Step 3: Retry loop if no QR yet and not connected
    if (!isConnected && !qrCode) {
      console.log("[evolution-create] Step 3: Retry loop to fetch QR (max 10 attempts, 3s interval)");

      for (let attempt = 1; attempt <= 10; attempt++) {
        await sleep(3000);

        const retryUrl = `${evolutionBaseUrl}/instance/connect/${instance_name}`;
        console.log(`[evolution-create] Retry ${attempt}/10: GET ${retryUrl}`);

        try {
          const retryRes = await fetch(retryUrl, {
            method: "GET",
            headers: { apikey: evolutionApiKey },
          });

          const retryStatus = retryRes.status;
          const retryText = await retryRes.text();
          console.log(`[evolution-create] Retry ${attempt} response: status=${retryStatus} body=${retryText.substring(0, 500)}`);

          if (retryRes.ok) {
            const retryData = JSON.parse(retryText);

            if (retryData?.instance?.state === "open" || retryData?.state === "open") {
              isConnected = true;
              console.log(`[evolution-create] Connected on retry ${attempt}`);
              break;
            }

            const retryQr = retryData?.base64 || retryData?.qrcode?.base64 || retryData?.instance?.qrcode || null;
            if (retryQr) {
              qrCode = retryQr;
              console.log(`[evolution-create] QR found on retry ${attempt} (length=${qrCode.length})`);
              break;
            }
          }
        } catch (err) {
          console.error(`[evolution-create] Retry ${attempt} error:`, err);
        }
      }
    }

    // Step 4: Persist result
    if (isConnected) {
      console.log("[evolution-create] Final: CONNECTED");
      await supabase
        .from("whatsapp_integrations")
        .upsert({
          organization_id,
          provider: "evolution",
          instance_name,
          status: "connected",
          qr_code_data: null,
          connected_at: new Date().toISOString(),
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: "organization_id" });

      return new Response(
        JSON.stringify({ success: true, instance_name, status: "connected", connected: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize QR format
    if (qrCode && !qrCode.startsWith("data:")) {
      // Ensure it's stored as a proper data URL
      qrCode = `data:image/png;base64,${qrCode}`;
    }

    console.log(`[evolution-create] Final: QR_PENDING qrCode=${qrCode ? `present (length=${qrCode.length})` : "null"}`);

    await supabase
      .from("whatsapp_integrations")
      .upsert({
        organization_id,
        provider: "evolution",
        instance_name,
        status: "qr_pending",
        qr_code_data: qrCode,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id" });

    if (!qrCode) {
      return new Response(
        JSON.stringify({
          success: true,
          instance_name,
          status: "qr_pending",
          qr_code: null,
          warning: "QR não disponível ainda. A instância foi criada — clique 'Atualizar QR' em alguns segundos.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, instance_name, status: "qr_pending", qr_code: qrCode }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[evolution-create] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
