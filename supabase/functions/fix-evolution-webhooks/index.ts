import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generateWebhookToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (!evolutionApiKey || !evolutionBaseUrl) {
      return respond({ ok: false, error: "EVOLUTION_API_KEY or EVOLUTION_BASE_URL not configured" }, 500);
    }

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const organizationId = body.organization_id;

    // Get integrations that need fixing (no webhook_token)
    let query = supabase
      .from("whatsapp_integrations")
      .select("id, instance_name, organization_id, webhook_token, status")
      .eq("is_active", true);

    if (organizationId) {
      query = query.eq("organization_id", organizationId);
    }

    const { data: integrations, error } = await query;
    if (error) return respond({ ok: false, error: error.message }, 500);

    const results: any[] = [];

    for (const integration of integrations || []) {
      // Generate token if missing
      const token = integration.webhook_token || generateWebhookToken();
      const webhookUrl = `${supabaseUrl}/functions/v1/evolution-webhook?token=${encodeURIComponent(token)}`;

      // Save token to DB
      if (!integration.webhook_token) {
        await supabase
          .from("whatsapp_integrations")
          .update({ webhook_token: token, updated_at: new Date().toISOString() })
          .eq("id", integration.id);
      }

      // Try to update webhook in Evolution API
      let apiResult = "not_attempted";
      const endpoints = [
        { url: `${evolutionBaseUrl}/webhook/set/${integration.instance_name}`, method: "POST" },
        { url: `${evolutionBaseUrl}/instance/update/${integration.instance_name}`, method: "PUT" },
      ];

      for (const ep of endpoints) {
        try {
          console.log(`[fix-webhooks] ${ep.method} ${ep.url}`);
          const res = await fetch(ep.url, {
            method: ep.method,
            headers: { "Content-Type": "application/json", apikey: evolutionApiKey },
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
          console.log(`[fix-webhooks] ${ep.method}: HTTP ${res.status} | ${text.substring(0, 200)}`);
          if (res.ok) {
            apiResult = "updated";
            break;
          } else {
            apiResult = `failed_${res.status}`;
          }
        } catch (err) {
          apiResult = `error: ${String(err).substring(0, 100)}`;
        }
      }

      results.push({
        instance_name: integration.instance_name,
        organization_id: integration.organization_id,
        token_saved: true,
        had_token: !!integration.webhook_token,
        api_webhook_update: apiResult,
      });
    }

    return respond({
      ok: true,
      message: `Processed ${results.length} integration(s)`,
      fixed: results.filter((r) => !r.had_token).length,
      details: results,
    });
  } catch (err) {
    console.error("[fix-webhooks] Error:", err);
    return respond({ ok: false, error: String(err) }, 500);
  }
});
