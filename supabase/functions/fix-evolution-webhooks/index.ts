import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");
    const evolutionBaseUrl = Deno.env.get("EVOLUTION_BASE_URL");
    const webhookSecret = Deno.env.get("EVOLUTION_WEBHOOK_SECRET");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (!evolutionApiKey || !evolutionBaseUrl) {
      return respond({ ok: false, error: "EVOLUTION_API_KEY or EVOLUTION_BASE_URL not configured" }, 500);
    }

    const { organization_id } = await req.json();

    // Build the correct webhook URL with token
    const webhookUrl = webhookSecret
      ? `${supabaseUrl}/functions/v1/evolution-webhook?token=${encodeURIComponent(webhookSecret)}`
      : `${supabaseUrl}/functions/v1/evolution-webhook`;

    // Get all active instances
    let query = supabase
      .from("whatsapp_integrations")
      .select("id, instance_name, organization_id, status")
      .eq("is_active", true);

    if (organization_id) {
      query = query.eq("organization_id", organization_id);
    }

    const { data: integrations, error } = await query;

    if (error) {
      return respond({ ok: false, error: error.message }, 500);
    }

    const results: any[] = [];

    for (const integration of integrations || []) {
      try {
        // Try multiple Evolution API endpoints for setting webhook
        const endpoints = [
          {
            url: `${evolutionBaseUrl}/webhook/instance/${integration.instance_name}`,
            method: "POST",
            body: {
              url: webhookUrl,
              enabled: true,
              webhook_by_events: false,
              webhook_base64: false,
              events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED", "MESSAGES_UPDATE"],
            },
          },
          {
            url: `${evolutionBaseUrl}/webhook/set/${integration.instance_name}`,
            method: "POST",
            body: {
              url: webhookUrl,
              enabled: true,
              webhook_by_events: false,
              events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED", "MESSAGES_UPDATE"],
            },
          },
        ];

        let success = false;
        let lastRes: any = null;
        let lastResText = "";

        for (const endpoint of endpoints) {
          console.log(`[fix-webhooks] Trying ${endpoint.method} ${endpoint.url}`);

          const res = await fetch(endpoint.url, {
            method: endpoint.method,
            headers: { "Content-Type": "application/json", apikey: evolutionApiKey },
            body: JSON.stringify(endpoint.body),
          });

          lastResText = await res.text();
          lastRes = res;
          console.log(`[fix-webhooks] ${endpoint.url}: HTTP ${res.status} - ${lastResText.substring(0, 200)}`);

          if (res.ok) {
            success = true;
            break;
          }
        }

        results.push({
          instance_name: integration.instance_name,
          organization_id: integration.organization_id,
          status: success ? "updated" : "error",
          http_status: lastRes?.status,
          response: lastResText.substring(0, 300),
        });
      } catch (err) {
        results.push({
          instance_name: integration.instance_name,
          organization_id: integration.organization_id,
          status: "error",
          error: String(err),
        });
      }
    }

    return respond({
      ok: true,
      webhook_url: webhookUrl,
      has_secret: !!webhookSecret,
      instances_processed: results.length,
      results,
    });
  } catch (err) {
    console.error("[fix-webhooks] Error:", err);
    return respond({ ok: false, error: String(err) }, 500);
  }
});
