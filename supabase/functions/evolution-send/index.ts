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

    const { organization_id, to_e164, message, lead_id, automation_run_id } = await req.json();

    if (!organization_id || !to_e164 || !message) {
      return new Response(
        JSON.stringify({ error: "organization_id, to_e164 e message são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get integration
    const { data: integration } = await supabase
      .from("whatsapp_integrations")
      .select("instance_name, status")
      .eq("organization_id", organization_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!integration) {
      return new Response(
        JSON.stringify({ error: "Integração WhatsApp não configurada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (integration.status !== "connected") {
      return new Response(
        JSON.stringify({ error: `WhatsApp não está conectado. Status atual: ${integration.status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const phone = to_e164.replace(/\D/g, "");

    // Send via Evolution API
    const sendRes = await fetch(
      `${evolutionBaseUrl}/message/sendText/${integration.instance_name}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: evolutionApiKey,
        },
        body: JSON.stringify({ number: phone, text: message }),
      }
    );

    const sendData = await sendRes.json();

    if (!sendRes.ok) {
      console.error("[evolution-send] Error:", sendData);
      await supabase.from("whatsapp_messages").insert({
        organization_id,
        lead_id: lead_id || null,
        automation_run_id: automation_run_id || null,
        direction: "outbound",
        phone,
        message_text: message,
        status: "failed",
        metadata: { error: sendData },
      });

      return new Response(
        JSON.stringify({ error: "Erro ao enviar mensagem", details: sendData }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const externalId = sendData?.key?.id || sendData?.messageId || null;
    await supabase.from("whatsapp_messages").insert({
      organization_id,
      lead_id: lead_id || null,
      automation_run_id: automation_run_id || null,
      direction: "outbound",
      phone,
      message_text: message,
      status: "sent",
      external_message_id: externalId,
      metadata: sendData,
    });

    console.log(`[evolution-send] Message sent to ${phone}`);

    return new Response(
      JSON.stringify({ success: true, message_id: externalId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[evolution-send] Error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
