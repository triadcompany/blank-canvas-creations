import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const invitationId = url.searchParams.get("id");
    const email = url.searchParams.get("email");

    console.log("Accept invitation called with:", { invitationId, email });

    if (!invitationId || !email) {
      return new Response("Parâmetros inválidos", { 
        status: 400,
        headers: corsHeaders 
      });
    }

    // Verificar se o convite existe e está pendente
    const { data: invitation, error: inviteError } = await supabase
      .from('user_invitations')
      .select('*')
      .eq('id', invitationId)
      .eq('email', email)
      .in('status', ['pending', 'direct_creation'])
      .single();

    if (inviteError || !invitation) {
      console.error("Invitation not found:", { inviteError, invitationId, email });
      return new Response(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Convite Inválido</title>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .error { color: #dc2626; }
            </style>
          </head>
          <body>
            <h1 class="error">Convite Inválido</h1>
            <p>Este convite não é válido ou já foi utilizado.</p>
          </body>
        </html>
      `, {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "text/html" }
      });
    }

    // Marcar convite como aceito
    const { error: updateError } = await supabase
      .from('user_invitations')
      .update({ status: 'accepted' })
      .eq('id', invitationId);

    if (updateError) {
      console.error("Erro ao aceitar convite:", updateError);
      return new Response("Erro interno", { 
        status: 500,
        headers: corsHeaders 
      });
    }

    // Buscar nome da organização
    const { data: organization } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', invitation.organization_id)
      .single();

    // Obter URL do frontend
    let frontendUrl = Deno.env.get("FRONTEND_URL") || "https://autolead.lovable.app";
    console.log("Using frontend URL:", frontendUrl);

    // Com Clerk, redireciona diretamente para a página de signup com os dados do convite
    const redirectUrl = `${frontendUrl}/auth?invited=true&email=${encodeURIComponent(email)}&name=${encodeURIComponent(invitation.name)}&role=${invitation.role}&orgId=${invitation.organization_id}&orgName=${encodeURIComponent(organization?.name || 'Organização')}`;
    
    console.log("Redirecting to:", redirectUrl);

    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Convite Aceito</title>
          <meta charset="UTF-8">
          <style>
            body { 
              font-family: Arial, sans-serif; 
              text-align: center; 
              padding: 50px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              margin: 0;
              min-height: 100vh;
            }
            .container {
              background: white;
              color: #333;
              max-width: 400px;
              margin: 0 auto;
              padding: 40px;
              border-radius: 10px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            }
            .success { color: #16a34a; font-size: 48px; margin-bottom: 20px; }
            .loading {
              border: 3px solid #f3f3f3;
              border-top: 3px solid #3498db;
              border-radius: 50%;
              width: 30px;
              height: 30px;
              animation: spin 1s linear infinite;
              margin: 20px auto;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            a { color: #667eea; }
          </style>
          <script>
            setTimeout(function() {
              window.location.href = "${redirectUrl}";
            }, 1000);
          </script>
        </head>
        <body>
          <div class="container">
            <div class="success">✓</div>
            <h1>Convite Aceito!</h1>
            <p>Redirecionando para criar sua conta...</p>
            <div class="loading"></div>
            <p><a href="${redirectUrl}">Clique aqui se não for redirecionado</a></p>
          </div>
        </body>
      </html>
    `, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/html" }
    });

  } catch (error: any) {
    console.error("Erro no accept-invitation:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
