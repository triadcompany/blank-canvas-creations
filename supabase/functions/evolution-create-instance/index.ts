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

    const { organization_id, evolution_base_url } = await req.json();

    if (!organization_id || !evolution_base_url) {
      return new Response(
        JSON.stringify({ error: "organization_id e evolution_base_url são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const instanceName = `autolead_${organization_id.replace(/-/g, "").substring(0, 16)}`;

    console.log(`[evolution-create] Creating instance: ${instanceName} at ${evolution_base_url}`);

    // Create instance in Evolution API
    const createRes = await fetch(`${evolution_base_url}/instance/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: evolutionApiKey,
      },
      body: JSON.stringify({
        instanceName,
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

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error("[evolution-create] API error:", errText);
      
      // Instance might already exist, try to connect it
      if (errText.includes("already") || errText.includes("exists")) {
        console.log("[evolution-create] Instance exists, connecting...");
        
        const connectRes = await fetch(`${evolution_base_url}/instance/connect/${instanceName}`, {
          method: "GET",
          headers: { apikey: evolutionApiKey },
        });
        
        if (!connectRes.ok) {
          return new Response(
            JSON.stringify({ error: "Instância existe mas não foi possível conectar", details: errText }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        return new Response(
          JSON.stringify({ error: "Erro ao criar instância Evolution", details: errText }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Upsert in whatsapp_integrations
    const { data: existing } = await supabase
      .from("whatsapp_integrations")
      .select("id")
      .eq("organization_id", organization_id)
      .maybeSingle();

    const integrationData = {
      organization_id,
      provider: "evolution",
      evolution_base_url,
      instance_name: instanceName,
      status: "qr_pending",
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await supabase
        .from("whatsapp_integrations")
        .update(integrationData)
        .eq("id", existing.id);
    } else {
      await supabase
        .from("whatsapp_integrations")
        .insert({ ...integrationData, created_by: null });
    }

    return new Response(
      JSON.stringify({ success: true, instance_name: instanceName, status: "qr_pending" }),
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
