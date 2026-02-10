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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (!evolutionApiKey) {
      return new Response(
        JSON.stringify({ error: "EVOLUTION_API_KEY não configurada" }),
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

    // Get integration
    const { data: integration, error } = await supabase
      .from("whatsapp_integrations")
      .select("instance_name, evolution_base_url, status")
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (error || !integration) {
      return new Response(
        JSON.stringify({ error: "Integração não encontrada. Crie uma instância primeiro." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (integration.status === "connected") {
      return new Response(
        JSON.stringify({ connected: true, message: "WhatsApp já está conectado" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch QR from Evolution
    const qrRes = await fetch(
      `${integration.evolution_base_url}/instance/connect/${integration.instance_name}`,
      {
        method: "GET",
        headers: { apikey: evolutionApiKey },
      }
    );

    if (!qrRes.ok) {
      const errText = await qrRes.text();
      console.error("[evolution-qr] Error:", errText);
      return new Response(
        JSON.stringify({ error: "Erro ao buscar QR code", details: errText }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const qrData = await qrRes.json();

    // Extract QR code - Evolution API returns different formats
    let qrCode = null;
    let pairingCode = null;
    
    if (qrData?.base64) {
      qrCode = qrData.base64;
    } else if (qrData?.qrcode?.base64) {
      qrCode = qrData.qrcode.base64;
    } else if (qrData?.instance?.qrcode) {
      qrCode = qrData.instance.qrcode;
    }
    
    if (qrData?.pairingCode) {
      pairingCode = qrData.pairingCode;
    } else if (qrData?.code) {
      pairingCode = qrData.code;
    }

    // Check if already connected
    if (qrData?.instance?.state === "open" || qrData?.state === "open") {
      await supabase
        .from("whatsapp_integrations")
        .update({ status: "connected", updated_at: new Date().toISOString() })
        .eq("organization_id", organization_id);

      return new Response(
        JSON.stringify({ connected: true, message: "WhatsApp conectado!" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ 
        qr_code: qrCode, 
        pairing_code: pairingCode,
        status: "qr_pending" 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[evolution-qr] Error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
