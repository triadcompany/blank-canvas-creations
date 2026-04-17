import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-clerk-user-id",
};

interface ManageRequest {
  action: "revoke" | "resend";
  invitationId: string;
  organizationId: string;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getSiteUrl(req: Request) {
  const raw =
    Deno.env.get("FRONTEND_URL") ||
    Deno.env.get("SITE_URL") ||
    req.headers.get("origin") ||
    "https://autolead.lovable.app";
  return raw.replace(/\/+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { action, invitationId, organizationId }: ManageRequest = await req.json();

    if (!action || !invitationId || !organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: "Parâmetros inválidos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: invite, error: fetchErr } = await supabase
      .from("user_invitations")
      .select("id, email, name, role, organization_id, status")
      .eq("id", invitationId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (fetchErr || !invite) {
      return new Response(
        JSON.stringify({ success: false, error: "Convite não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "revoke") {
      const { error } = await supabase
        .from("user_invitations")
        .update({ status: "revoked" })
        .eq("id", invitationId);

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, message: "Convite revogado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "resend") {
      const newToken = generateToken();
      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const siteUrl = getSiteUrl(req);

      const { error: updateErr } = await supabase
        .from("user_invitations")
        .update({
          token: newToken,
          expires_at: newExpiresAt,
          status: "pending",
        })
        .eq("id", invitationId);

      if (updateErr) throw updateErr;

      const inviteUrl = `${siteUrl}/invite?token=${newToken}`;

      // Reenvia via Clerk
      const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
      if (clerkSecretKey) {
        try {
          const { data: org } = await supabase
            .from("organizations")
            .select("name")
            .eq("id", invite.organization_id)
            .maybeSingle();

          await fetch("https://api.clerk.com/v1/invitations", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${clerkSecretKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email_address: invite.email,
              redirect_url: inviteUrl,
              ignore_existing: true,
              public_metadata: {
                invited_name: invite.name,
                invited_role: invite.role,
                organization_id: invite.organization_id,
                organization_name: org?.name || "Organização",
                invitation_token: newToken,
              },
            }),
          });
        } catch (clerkErr) {
          console.warn("⚠️ Clerk resend warning:", clerkErr);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Convite reenviado",
          inviteUrl,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Ação inválida" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("❌ manage-invitation error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
