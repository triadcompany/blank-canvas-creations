import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-clerk-user-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface InviteUserRequest {
  email: string;
  name: string;
  role: "admin" | "seller";
  organizationId: string;
  invitedByClerkUserId?: string;
  forceResend?: boolean;
}

function normalizeSiteUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function getSiteUrl(req: Request) {
  const raw =
    Deno.env.get("FRONTEND_URL") ||
    Deno.env.get("SITE_URL") ||
    req.headers.get("origin") ||
    "https://autolead.lovable.app";
  return normalizeSiteUrl(raw);
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🚀 invite-user function called");

    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
    if (!clerkSecretKey) {
      throw new Error("CLERK_SECRET_KEY não configurado");
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const body: InviteUserRequest = await req.json();
    const { email, name, role, organizationId, invitedByClerkUserId, forceResend } = body;
    const siteUrl = getSiteUrl(req);

    console.log("📧 Processing invite", { email, name, role, organizationId, forceResend });

    if (!email || !name || !role || !organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: "Campos obrigatórios: email, name, role, organizationId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Verificar se já é membro ativo da organização
    const { data: existingMember } = await supabaseAdmin
      .from("org_members")
      .select("clerk_user_id, status, profiles:clerk_user_id(email)")
      .eq("organization_id", organizationId)
      .eq("status", "active");

    if (existingMember && existingMember.length > 0) {
      // Verifica se algum dos membros tem esse email no profile
      const { data: profileMatch } = await supabaseAdmin
        .from("profiles")
        .select("clerk_user_id")
        .eq("organization_id", organizationId)
        .ilike("email", normalizedEmail)
        .maybeSingle();

      if (profileMatch) {
        return new Response(
          JSON.stringify({
            success: false,
            code: "ALREADY_MEMBER",
            error: "Usuário já é membro desta organização",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 2. Buscar nome da organização
    const { data: organization } = await supabaseAdmin
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .single();

    const organizationName = organization?.name || "Organização";

    // 3. Resolver invited_by (profile.id do admin logado)
    let invitedByProfileId: string | null = null;
    if (invitedByClerkUserId) {
      const { data: inviterProfile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("clerk_user_id", invitedByClerkUserId)
        .maybeSingle();
      invitedByProfileId = inviterProfile?.id || null;
    }

    // 4. Verificar se já existe convite PENDING para este email na org
    const { data: existingInvite } = await supabaseAdmin
      .from("user_invitations")
      .select("id, status, expires_at")
      .eq("email", normalizedEmail)
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .maybeSingle();

    const newToken = generateToken();
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    let invitationId: string;

    if (existingInvite) {
      if (!forceResend) {
        return new Response(
          JSON.stringify({
            success: false,
            code: "INVITE_PENDING",
            error: "Já existe convite pendente para este email",
            invitationId: existingInvite.id,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("🔁 Reenviando convite existente:", existingInvite.id);
      const { error: updateError } = await supabaseAdmin
        .from("user_invitations")
        .update({
          name,
          role: role === "admin" ? "admin" : "seller",
          token: newToken,
          expires_at: newExpiresAt,
          ...(invitedByProfileId ? { invited_by: invitedByProfileId } : {}),
        })
        .eq("id", existingInvite.id);

      if (updateError) {
        console.error("❌ Erro ao atualizar convite:", updateError);
        return new Response(
          JSON.stringify({ success: false, error: updateError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      invitationId = existingInvite.id;
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("user_invitations")
        .insert({
          email: normalizedEmail,
          name,
          role: role === "admin" ? "admin" : "seller",
          organization_id: organizationId,
          status: "pending",
          token: newToken,
          expires_at: newExpiresAt,
          ...(invitedByProfileId ? { invited_by: invitedByProfileId } : {}),
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("❌ Erro ao criar convite:", insertError);
        return new Response(
          JSON.stringify({ success: false, error: insertError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      invitationId = inserted.id;
    }

    // 5. Link público do nosso app que valida o token e redireciona ao Clerk
    const inviteUrl = `${siteUrl}/invite?token=${newToken}`;

    // 6. Enviar via Clerk Invitations API (email com link do nosso /invite)
    console.log("📧 Sending invitation via Clerk API → /invite link");
    const clerkResponse = await fetch("https://api.clerk.com/v1/invitations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: normalizedEmail,
        redirect_url: inviteUrl,
        ignore_existing: true,
        public_metadata: {
          invited_name: name,
          invited_role: role,
          organization_id: organizationId,
          organization_name: organizationName,
          invitation_token: newToken,
        },
      }),
    });

    const clerkData = await clerkResponse.json();
    console.log("📧 Clerk response:", clerkResponse.status);

    if (!clerkResponse.ok) {
      const errorMsg =
        clerkData?.errors?.[0]?.long_message ||
        clerkData?.errors?.[0]?.message ||
        clerkData?.message ||
        "Erro ao enviar convite via Clerk";

      // Se for "already_invited" ou similar, ainda assim consideramos OK pois
      // nosso convite local foi criado/atualizado
      const code = clerkData?.errors?.[0]?.code;
      const isSoftError = code === "duplicate_record" || code === "already_invited";

      if (!isSoftError) {
        console.error("❌ Clerk API error:", JSON.stringify(clerkData));
        return new Response(
          JSON.stringify({
            success: false,
            error: errorMsg,
            inviteUrl, // mesmo com erro, devolve URL para envio manual
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.warn("⚠️ Clerk soft error, prosseguindo:", code);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Convite enviado para ${name} (${normalizedEmail})`,
        invitationId,
        inviteUrl,
        signUpUrl: inviteUrl,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("❌ Error in invite-user:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro interno do servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

Deno.serve(handler);
