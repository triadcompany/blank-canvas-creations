import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || (await req.json().catch(() => ({}))).token;

    if (!token) {
      return new Response(
        JSON.stringify({ ok: false, code: "MISSING_TOKEN", error: "Token não fornecido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: invite } = await supabase
      .from("user_invitations")
      .select("id, email, name, role, status, expires_at, organization_id, accepted_at")
      .eq("token", token)
      .maybeSingle();

    if (!invite) {
      return new Response(
        JSON.stringify({ ok: false, code: "NOT_FOUND", error: "Convite não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (invite.status === "accepted") {
      return new Response(
        JSON.stringify({ ok: false, code: "ACCEPTED", error: "Este convite já foi aceito", email: invite.email }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (invite.status === "revoked") {
      return new Response(
        JSON.stringify({ ok: false, code: "REVOKED", error: "Este convite foi revogado" }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ ok: false, code: "EXPIRED", error: "Convite expirado", email: invite.email }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Org name lives in clerk_organizations (Clerk-managed). Fallback to legacy organizations table.
    let orgName: string | null = null;
    const { data: clerkOrg } = await supabase
      .from("clerk_organizations")
      .select("name")
      .eq("id", invite.organization_id)
      .maybeSingle();
    orgName = clerkOrg?.name ?? null;

    if (!orgName) {
      const { data: legacyOrg } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", invite.organization_id)
        .maybeSingle();
      orgName = legacyOrg?.name ?? null;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        invitation: {
          id: invite.id,
          email: invite.email,
          name: invite.name,
          role: invite.role,
          organization_id: invite.organization_id,
          organization_name: org?.name || "Organização",
          expires_at: invite.expires_at,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("❌ validate-invitation error:", err);
    return new Response(
      JSON.stringify({ ok: false, code: "INTERNAL", error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
