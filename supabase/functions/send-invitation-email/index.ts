import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InvitationEmailRequest {
  email: string;
  name: string;
  organizationName: string;
  inviterName: string;
  invitationId: string;
}

const handler = async (req: Request): Promise<Response> => {
  console.log('📧 send-invitation-email function called');
  
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    console.log('📧 CORS preflight request');
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('📧 Processing invitation email request...');
    const { email, name, organizationName, inviterName, invitationId }: InvitationEmailRequest = await req.json();
    
    console.log('📧 Request data:', { email, name, organizationName, inviterName, invitationId });

    // Verificar se RESEND_API_KEY está configurado
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error('❌ RESEND_API_KEY não configurado');
      throw new Error('RESEND_API_KEY não configurado');
    }
    
    console.log('📧 RESEND_API_KEY está configurado');

    // Criar URL de aceitação do convite
    const acceptUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/accept-invitation?id=${invitationId}&email=${encodeURIComponent(email)}`;
    
    console.log('📧 Accept URL:', acceptUrl);

    console.log('📧 Enviando email via Resend...');
    const emailResponse = await resend.emails.send({
      from: "Triad Company CRM <onboarding@resend.dev>",
      to: [email],
      subject: `Bem-vindo ao CRM ${organizationName}!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
          <div style="background-color: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #1f2937; margin-bottom: 10px; font-size: 28px;">🎉 Bem-vindo!</h1>
              <h2 style="color: #3B82F6; margin: 0; font-size: 20px;">CRM ${organizationName}</h2>
            </div>
            
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Olá <strong>${name}</strong>,
            </p>
            
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
              Você foi convidado por <strong>${inviterName}</strong> para fazer parte da equipe do CRM da <strong>${organizationName}</strong>. 
              Estamos muito felizes em tê-lo conosco!
            </p>
            
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
              <strong>Clique no link abaixo para aceitar o convite e começar a usar o sistema:</strong>
            </p>
            
            <div style="margin: 40px 0; text-align: center;">
              <a href="${acceptUrl}" style="
                background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%);
                color: white;
                padding: 15px 30px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: bold;
                font-size: 16px;
                display: inline-block;
                box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
                transition: all 0.3s ease;
              ">
                ✅ Aceitar Convite e Criar Conta
              </a>
            </div>
            
            <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 30px 0;">
              <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin: 0;">
                <strong>Próximos passos:</strong><br>
                1. Clique no botão acima<br>
                2. Complete seu cadastro criando uma senha<br>
                3. Acesse o sistema e comece a trabalhar!
              </p>
            </div>
            
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
            
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Se você não esperava este convite, pode ignorar este email com segurança.<br>
              Este convite foi enviado por ${inviterName} da ${organizationName}.
            </p>
          </div>
        </div>
      `,
    });

    console.log("Email de convite enviado com sucesso:", emailResponse);

    return new Response(JSON.stringify(emailResponse), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Erro ao enviar email de convite:", error);
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