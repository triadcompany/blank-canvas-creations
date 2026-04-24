// One-shot admin tool: inspect & fix the Evolution webhook for a
// `whatsapp_connections` (v2) instance. Use when the instance shows as
// "connected" but no events are reaching `whatsapp-webhook-v2`.
//
// POST { "instance_name": "extreme-car_30941699", "fix": true }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evoBase = Deno.env.get("EVOLUTION_BASE_URL");
    const evoKey = Deno.env.get("EVOLUTION_API_KEY");
    if (!evoBase || !evoKey) {
      return respond({ ok: false, error: "Evolution env not configured" }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({} as any));
    const instanceName: string | undefined = body.instance_name;
    const orgId: string | undefined = body.organization_id;
    const fix: boolean = !!body.fix;

    let conn: any = null;
    if (instanceName) {
      const { data } = await supabase
        .from("whatsapp_connections")
        .select("id, organization_id, instance_name, status, mirror_enabled")
        .eq("instance_name", instanceName)
        .maybeSingle();
      conn = data;
    } else if (orgId) {
      const { data } = await supabase
        .from("whatsapp_connections")
        .select("id, organization_id, instance_name, status, mirror_enabled")
        .eq("organization_id", orgId)
        .maybeSingle();
      conn = data;
    }
    if (!conn) return respond({ ok: false, error: "connection not found" }, 404);

    const expectedWebhook = `${supabaseUrl}/functions/v1/whatsapp-webhook-v2`;

    // 1) Inspect current webhook on Evolution
    const findUrl = `${evoBase}/webhook/find/${conn.instance_name}`;
    const findRes = await fetch(findUrl, {
      method: "GET",
      headers: { apikey: evoKey },
    });
    const findText = await findRes.text();
    let currentWebhook: any = null;
    try { currentWebhook = JSON.parse(findText); } catch { currentWebhook = findText; }

    // 2) Inspect connection state
    const stateRes = await fetch(`${evoBase}/instance/connectionState/${conn.instance_name}`, {
      method: "GET",
      headers: { apikey: evoKey },
    });
    const stateText = await stateRes.text();
    let stateInfo: any = null;
    try { stateInfo = JSON.parse(stateText); } catch { stateInfo = stateText; }

    let setResult: any = null;
    if (fix) {
      // Set webhook to v2 with the right events
      const setUrl = `${evoBase}/webhook/set/${conn.instance_name}`;
      const payload = {
        webhook: {
          enabled: true,
          url: expectedWebhook,
          webhook_by_events: false,
          webhook_base64: false,
          events: [
            "MESSAGES_UPSERT",
            "CONNECTION_UPDATE",
            "MESSAGES_UPDATE",
            "SEND_MESSAGE",
          ],
        },
        // Some Evolution versions accept the flat shape too
        enabled: true,
        url: expectedWebhook,
        webhook_by_events: false,
        webhook_base64: false,
        events: [
          "MESSAGES_UPSERT",
          "CONNECTION_UPDATE",
          "MESSAGES_UPDATE",
          "SEND_MESSAGE",
        ],
      };
      const setRes = await fetch(setUrl, {
        method: "POST",
        headers: { apikey: evoKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const setText = await setRes.text();
      let parsed: any = null;
      try { parsed = JSON.parse(setText); } catch { parsed = setText; }
      setResult = { status: setRes.status, body: parsed };
    }

    return respond({
      ok: true,
      connection: conn,
      expected_webhook: expectedWebhook,
      current_webhook: { status: findRes.status, body: currentWebhook },
      live_state: { status: stateRes.status, body: stateInfo },
      fix_applied: fix,
      set_result: setResult,
    });
  } catch (e) {
    return respond({ ok: false, error: String(e) }, 500);
  }
});
