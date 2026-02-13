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

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🚀 invite-user function called (Clerk version)");

    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
    if (!clerkSecretKey) {
      throw new Error("CLERK_SECRET_KEY não configurado");
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { email, name, role, organizationId }: InviteUserRequest = await req.json();
    const siteUrl = getSiteUrl(req);

    console.log("📧 Processing invite", { email, name, role, organizationId, siteUrl });

    if (!email || !name || !role || !organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: "Campos obrigatórios: email, name, role, organizationId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar nome da organização
    const { data: organization } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .single();

    const organizationName = organization?.name || 'Organização';

    // Verificar se já existe um convite pendente para este email
    const { data: existingInvite } = await supabaseAdmin
      .from('user_invitations')
      .select('id')
      .eq('email', email)
      .eq('organization_id', organizationId)
      .eq('status', 'pending')
      .single();

    if (existingInvite) {
      console.log("⚠️ Invite already exists, updating...");
      await supabaseAdmin
        .from('user_invitations')
        .update({ name, role: role === 'admin' ? 'admin' : 'seller', updated_at: new Date().toISOString() })
        .eq('id', existingInvite.id);
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('user_invitations')
        .insert({
          email,
          name,
          role: role === 'admin' ? 'admin' : 'seller',
          organization_id: organizationId,
          status: 'pending',
        });

      if (insertError) {
        console.error("❌ Error creating invitation:", insertError);
        return new Response(
          JSON.stringify({ success: false, error: insertError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Enviar convite via Clerk API
    const redirectUrl = `${siteUrl}/auth?invited=true&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&role=${role}&orgId=${organizationId}&orgName=${encodeURIComponent(organizationName)}`;

    console.log("📧 Sending invitation via Clerk API...");
    const clerkResponse = await fetch("https://api.clerk.com/v1/invitations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: email,
        redirect_url: redirectUrl,
        ignore_existing: true,
        public_metadata: {
          invited_name: name,
          invited_role: role,
          organization_id: organizationId,
          organization_name: organizationName,
        },
      }),
    });

    const clerkData = await clerkResponse.json();
    console.log("📧 Clerk API response status:", clerkResponse.status, "body:", JSON.stringify(clerkData));

    if (!clerkResponse.ok) {
      console.error("❌ Clerk API error:", JSON.stringify(clerkData));
      const errorMsg = clerkData?.errors?.[0]?.long_message || clerkData?.errors?.[0]?.message || clerkData?.message || "Erro ao enviar convite via Clerk";
      throw new Error(errorMsg);
    }

    console.log("✅ Clerk invitation sent successfully:", clerkData.id, "status:", clerkData.status);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Convite enviado para ${name} (${email})`,
        signUpUrl: redirectUrl,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("❌ Error in invite-user function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro interno do servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

Deno.serve(handler);
