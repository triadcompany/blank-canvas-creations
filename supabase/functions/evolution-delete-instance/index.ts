import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Fully tear down a WhatsApp Evolution instance for a given organization.
 *
 * Steps:
 *  1. Logout the WhatsApp session (so the phone forgets this device).
 *  2. Delete the instance from Evolution (frees the instance_name globally).
 *  3. Delete the row in `whatsapp_integrations` for this org.
 *
 * Even if Evolution returns 404 (instance already gone) or any non-fatal error,
 * we still remove the local row so the UI returns to a clean state.
 */
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

    const { organization_id } = await req.json();

    if (!organization_id) {
      return respond({ ok: false, message: "organization_id obrigatório" }, 400);
    }

    console.log(`[evolution-delete] === START === org=${organization_id}`);

    // ── Load current integration to know which instance_name to tear down ──
    const { data: integration } = await supabase
      .from("whatsapp_integrations")
      .select("id, instance_name")
      .eq("organization_id", organization_id)
      .maybeSingle();

    const instanceName = integration?.instance_name || null;
    const evolutionResults: Record<string, unknown> = {};

    if (instanceName && evolutionApiKey && evolutionBaseUrl) {
      // ── Step 1: logout ──
      try {
        const logoutUrl = `${evolutionBaseUrl}/instance/logout/${instanceName}`;
        console.log(`[evolution-delete] Step 1: DELETE ${logoutUrl}`);
        const r = await fetch(logoutUrl, {
          method: "DELETE",
          headers: { apikey: evolutionApiKey },
        });
        const text = await r.text();
        console.log(`[evolution-delete] Logout: HTTP ${r.status} | ${text.substring(0, 200)}`);
        evolutionResults.logout = { status: r.status, body: text.substring(0, 200) };
      } catch (err) {
        console.error("[evolution-delete] Logout error:", err);
        evolutionResults.logout = { error: String(err) };
      }

      // ── Step 2: delete instance ──
      try {
        const deleteUrl = `${evolutionBaseUrl}/instance/delete/${instanceName}`;
        console.log(`[evolution-delete] Step 2: DELETE ${deleteUrl}`);
        const r = await fetch(deleteUrl, {
          method: "DELETE",
          headers: { apikey: evolutionApiKey },
        });
        const text = await r.text();
        console.log(`[evolution-delete] Delete: HTTP ${r.status} | ${text.substring(0, 200)}`);
        evolutionResults.delete = { status: r.status, body: text.substring(0, 200) };
      } catch (err) {
        console.error("[evolution-delete] Delete error:", err);
        evolutionResults.delete = { error: String(err) };
      }
    } else {
      console.log(`[evolution-delete] Skipping Evolution calls (instance=${instanceName}, hasSecrets=${!!evolutionApiKey && !!evolutionBaseUrl})`);
    }

    // ── Step 3: remove local row (always, even if Evolution failed) ──
    if (integration?.id) {
      const { error: deleteErr } = await supabase
        .from("whatsapp_integrations")
        .delete()
        .eq("id", integration.id);

      if (deleteErr) {
        console.error("[evolution-delete] DB delete error:", deleteErr);
        return respond({
          ok: false,
          message: `Instância removida da Evolution mas falhou ao remover integração local: ${deleteErr.message}`,
          evolution: evolutionResults,
        }, 500);
      }
    }

    console.log("[evolution-delete] === DONE ===");
    return respond({
      ok: true,
      message: "Configuração limpa com sucesso",
      instance_name: instanceName,
      evolution: evolutionResults,
    });
  } catch (err) {
    console.error("[evolution-delete] Unhandled:", err);
    return respond({ ok: false, message: String(err) }, 500);
  }
});
