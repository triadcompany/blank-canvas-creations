import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InviteUserRequest {
  email: string;
  name: string;
  role: "admin" | "seller";
  organizationId: string;
}

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

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

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendInviteEmail(params: {
  to: string;
  name: string;
  signUpUrl: string;
  organizationName: string;
  role: string;
  siteUrl: string;
}) {
  const safeName = escapeHtml(params.name);
  const safeOrgName = escapeHtml(params.organizationName);
  const roleLabel = params.role === 'admin' ? 'Administrador' : 'Vendedor';

  const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background:#f7f7f8; padding:24px;">
    <div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:12px; padding:24px; border:1px solid #e6e6e8;">
      <h2 style="margin:0 0 12px 0; font-size:18px; color:#111827;">Você foi convidado para ${safeOrgName}</h2>
      <p style="margin:0 0 18px 0; font-size:14px; line-height:1.5; color:#374151;">
        Olá ${safeName}, você foi convidado como <strong>${roleLabel}</strong> para acessar o sistema de CRM.
        Clique no botão abaixo para criar sua conta.
      </p>
      <a href="${params.signUpUrl}" style="display:inline-block; background:#111827; color:#ffffff; text-decoration:none; padding:10px 14px; border-radius:10px; font-size:14px;">
        Criar minha conta
      </a>
      <p style="margin:18px 0 0 0; font-size:12px; color:#6b7280;">Se você não esperava este convite, ignore este email.</p>
      <p style="margin:12px 0 0 0; font-size:12px; color:#6b7280;">Abrir sistema: <a href="${params.siteUrl}" style="color:#6b7280;">${params.siteUrl}</a></p>
    </div>
  </div>`;

  const resendResponse = await resend.emails.send({
    from: "Essencial Light <onboarding@resend.dev>",
    to: [params.to],
    subject: `Convite para ${safeOrgName}`,
    html,
  });

  const resendError = (resendResponse as any)?.error;
  if (resendError) {
    throw new Error(
      typeof resendError === "string"
        ? resendError
        : resendError?.message || "Falha ao enviar email"
    );
  }

  return resendResponse;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🚀 invite-user function called (Clerk version)");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { email, name, role, organizationId }: InviteUserRequest = await req.json();
    const siteUrl = getSiteUrl(req);

    console.log("📧 Processing invite", { email, name, role, organizationId, siteUrl });

    if (!email || !name || !role || !organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: "Campos obrigatórios: email, name, role, organizationId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
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
      // Criar novo convite na tabela user_invitations
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
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Com Clerk, o convite redireciona para a página de signup com parâmetros
    const signUpUrl = `${siteUrl}/auth?invited=true&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&role=${role}&orgId=${organizationId}&orgName=${encodeURIComponent(organizationName)}`;

    // Enviar email via Resend
    await sendInviteEmail({
      to: email,
      name,
      signUpUrl,
      organizationName,
      role,
      siteUrl,
    });

    console.log("✅ Invite email sent successfully");

    return new Response(
      JSON.stringify({
        success: true,
        message: `Convite enviado para ${name} (${email})`,
        signUpUrl, // Inclui URL para compartilhamento manual se necessário
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("❌ Error in invite-user function:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Erro interno do servidor",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
