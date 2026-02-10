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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { organization_id } = await req.json();
    if (!organization_id) {
      return respond({ ok: false, integration: null, message: "organization_id obrigatório" }, 400);
    }

    const { data, error } = await supabase
      .from("whatsapp_integrations")
      .select("id, organization_id, provider, instance_name, status, is_active, phone_number, qr_code_data, connected_at, updated_at")
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (error) {
      console.error("[evolution-get-status] DB error:", error);
      return respond({ ok: false, integration: null, message: error.message }, 500);
    }

    return respond({ ok: true, integration: data });
  } catch (err) {
    console.error("[evolution-get-status] Unhandled:", err);
    return respond({ ok: false, integration: null, message: String(err) }, 500);
  }
});
