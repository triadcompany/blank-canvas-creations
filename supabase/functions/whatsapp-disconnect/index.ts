// whatsapp-disconnect: desconecta e deleta a instância na Evolution
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-clerk-user-id, x-clerk-org-id, x-organization-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evoUrl = Deno.env.get("EVOLUTION_BASE_URL");
    const evoKey = Deno.env.get("EVOLUTION_API_KEY");

    const supabase = createClient(supabaseUrl, serviceKey);
    const clerkUserId = req.headers.get("x-clerk-user-id");
    const { organization_id } = await req.json();

    if (!organization_id) return respond({ ok: false, error: "organization_id obrigatório" }, 400);
    if (!clerkUserId) return respond({ ok: false, error: "x-clerk-user-id ausente" }, 401);

    // Valida membership ativo via org_members (multi-org safe).
    const { data: member } = await supabase
      .from("org_members")
      .select("role, status")
      .eq("clerk_user_id", clerkUserId)
      .eq("organization_id", organization_id)
      .eq("status", "active")
      .maybeSingle();

    if (!member) return respond({ ok: false, error: "Usuário não pertence à organização" }, 403);

    const { data: conn } = await supabase
      .from("whatsapp_connections")
      .select("id, instance_name")
      .eq("organization_id", organization_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conn) return respond({ ok: true, message: "Nenhuma conexão para desconectar" });

    // Logout + delete na Evolution
    if (evoUrl && evoKey && conn.instance_name) {
      try {
        await fetch(`${evoUrl}/instance/logout/${conn.instance_name}`, {
          method: "DELETE",
          headers: { apikey: evoKey },
        });
      } catch (_) { /* ignore */ }
      try {
        await fetch(`${evoUrl}/instance/delete/${conn.instance_name}`, {
          method: "DELETE",
          headers: { apikey: evoKey },
        });
      } catch (_) { /* ignore */ }
    }

    const { error: updErr } = await supabase
      .from("whatsapp_connections")
      .update({
        status: "disconnected",
        qr_code: null,
        last_disconnected_at: new Date().toISOString(),
      })
      .eq("id", conn.id);

    if (updErr) return respond({ ok: false, error: updErr.message }, 500);

    return respond({ ok: true, message: "WhatsApp desconectado" });
  } catch (err) {
    console.error("[whatsapp-disconnect] Unhandled:", err);
    return respond({ ok: false, error: String(err) }, 500);
  }
});
