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

    const { organization_id, check_live } = await req.json();
    if (!organization_id) {
      return respond({ ok: false, integration: null, message: "organization_id obrigatório" }, 400);
    }

    // 1. Get DB record
    const { data, error } = await supabase
      .from("whatsapp_integrations")
      .select("id, organization_id, provider, instance_name, status, is_active, phone_number, qr_code_data, connected_at, updated_at")
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (error) {
      console.error("[evolution-get-status] DB error:", error);
      return respond({ ok: false, integration: null, message: error.message }, 500);
    }

    if (!data) {
      return respond({ ok: true, integration: null, live_status: null });
    }

    // 2. If check_live requested AND we have Evolution secrets + instance_name, query the real API
    let liveStatus: string | null = null;
    let liveError: string | null = null;
    let availableInstances: string[] | null = null;
    let instanceFound = true;

    if (check_live && evolutionApiKey && evolutionBaseUrl && data.instance_name) {
      try {
        // Check connection state
        const stateUrl = `${evolutionBaseUrl}/instance/connectionState/${data.instance_name}`;
        console.log(`[evolution-get-status] Checking live: GET ${stateUrl}`);
        const stateRes = await fetch(stateUrl, {
          method: "GET",
          headers: { apikey: evolutionApiKey },
        });
        const stateText = await stateRes.text();
        console.log(`[evolution-get-status] Live: HTTP ${stateRes.status} | ${stateText.substring(0, 300)}`);

        if (stateRes.ok) {
          try {
            const stateData = JSON.parse(stateText);
            // Evolution API returns { instance: { state: "open" | "close" | ... } } or { state: "..." }
            const state =
              stateData?.instance?.state ||
              stateData?.state ||
              stateData?.instance?.status ||
              stateData?.status ||
              null;

            if (state === "open" || state === "connected") {
              liveStatus = "connected";
            } else if (state === "close" || state === "closed" || state === "disconnected") {
              liveStatus = "disconnected";
            } else if (state === "connecting" || state === "pairing" || state === "qrcode") {
              liveStatus = "pairing";
            } else {
              liveStatus = state || "unknown";
            }
          } catch {
            liveStatus = "parse_error";
            liveError = stateText.substring(0, 200);
          }
        } else if (stateRes.status === 404) {
          // Instance doesn't exist on this server
          liveStatus = "not_found";
          instanceFound = false;
        } else {
          liveStatus = "api_error";
          liveError = `HTTP ${stateRes.status}: ${stateText.substring(0, 200)}`;
        }

        // If instance not found, try listing available instances
        if (!instanceFound) {
          try {
            const listUrl = `${evolutionBaseUrl}/instance/fetchInstances`;
            const listRes = await fetch(listUrl, {
              method: "GET",
              headers: { apikey: evolutionApiKey },
            });
            if (listRes.ok) {
              const listData = await listRes.json();
              if (Array.isArray(listData)) {
                availableInstances = listData.map((i: any) => i.instance?.instanceName || i.instanceName || i.name).filter(Boolean);
              }
            }
          } catch (e) {
            console.error("[evolution-get-status] List instances error:", e);
          }
        }

        // Sync status to DB if it changed
        if (liveStatus === "connected" && data.status !== "connected") {
          await supabase
            .from("whatsapp_integrations")
            .update({ status: "connected", qr_code_data: null, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", data.id);
          data.status = "connected";
          data.qr_code_data = null;
          data.connected_at = new Date().toISOString();
        } else if (liveStatus === "disconnected" && data.status === "connected") {
          await supabase
            .from("whatsapp_integrations")
            .update({ status: "disconnected", connected_at: null, updated_at: new Date().toISOString() })
            .eq("id", data.id);
          data.status = "disconnected";
          data.connected_at = null;
        }
      } catch (err) {
        console.error("[evolution-get-status] Live check error:", err);
        liveError = String(err);
      }
    }

    return respond({
      ok: true,
      integration: data,
      live_status: liveStatus,
      live_error: liveError,
      instance_found: instanceFound,
      available_instances: availableInstances,
    });
  } catch (err) {
    console.error("[evolution-get-status] Unhandled:", err);
    return respond({ ok: false, integration: null, message: String(err) }, 500);
  }
});
