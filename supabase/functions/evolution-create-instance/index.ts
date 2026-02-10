import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // Validate instance_name format
    if (!/^[a-z0-9_-]{3,40}$/.test(instance_name)) {
      return new Response(
        JSON.stringify({ error: "instance_name deve ter 3-40 caracteres, lowercase, apenas letras, números, - e _" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[evolution-create] Creating instance: ${instance_name}`);

    // Create instance in Evolution API
    const createRes = await fetch(`${evolutionBaseUrl}/instance/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: evolutionApiKey,
      },
      body: JSON.stringify({
        instanceName: instance_name,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        reject_call: false,
        webhook: {
          url: `${supabaseUrl}/functions/v1/evolution-webhook`,
          enabled: true,
          webhookByEvents: true,
          events: [
            "MESSAGES_UPSERT",
            "CONNECTION_UPDATE",
            "QRCODE_UPDATED",
          ],
        },
      }),
    });

    let qrCode: string | null = null;

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error("[evolution-create] API error:", errText);

      // Instance might already exist, try to connect it
      if (errText.includes("already") || errText.includes("exists")) {
        console.log("[evolution-create] Instance exists, connecting...");
      } else {
        return new Response(
          JSON.stringify({ error: "Erro ao criar instância Evolution", details: errText }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Get QR code by connecting
    const connectRes = await fetch(`${evolutionBaseUrl}/instance/connect/${instance_name}`, {
      method: "GET",
      headers: { apikey: evolutionApiKey },
    });

    if (connectRes.ok) {
      const connectData = await connectRes.json();
      qrCode = connectData?.base64 || connectData?.qrcode?.base64 || connectData?.instance?.qrcode || null;

      // Check if already connected
      if (connectData?.instance?.state === "open" || connectData?.state === "open") {
        // Upsert as connected
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
    }

    // Upsert in whatsapp_integrations with QR pending
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

    return new Response(
      JSON.stringify({ success: true, instance_name, status: "qr_pending", qr_code: qrCode }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[evolution-create] Error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
