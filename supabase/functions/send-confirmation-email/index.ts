import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ConfirmationEmailRequest {
  email: string;
  name: string;
  confirmationUrl: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, name, confirmationUrl }: ConfirmationEmailRequest = await req.json();

    console.log("📧 Sending confirmation email to:", email);

    const emailResponse = await resend.emails.send({
      from: "CRM AutoLead <onboarding@resend.dev>",
      to: [email],
      subject: "Confirme sua conta - CRM AutoLead",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Confirme sua conta</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f97316, #fb923c); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #f97316; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
            .button:hover { background: #ea580c; }
            .footer { text-align: center; margin-top: 20px; font-size: 14px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚀 Bem-vindo ao CRM AutoLead!</h1>
            </div>
            <div class="content">
              <h2>Olá, ${name}!</h2>
              <p>Obrigado por se cadastrar no CRM AutoLead. Para completar sua conta e começar a usar nossa plataforma, você precisa confirmar seu endereço de email.</p>
              
              <p>Clique no botão abaixo para confirmar sua conta:</p>
              
              <div style="text-align: center;">
                <a href="${confirmationUrl}" class="button">✅ Confirmar Minha Conta</a>
              </div>
              
              <p>Se o botão não funcionar, você também pode copiar e colar o link abaixo no seu navegador:</p>
              <p style="word-break: break-all; background: #e5e7eb; padding: 10px; border-radius: 4px; font-family: monospace;">
                ${confirmationUrl}
              </p>
              
              <p><strong>⚠️ Importante:</strong> Este link expira em 24 horas por motivos de segurança.</p>
              
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
              
              <p><strong>O que acontece depois de confirmar:</strong></p>
              <ul>
                <li>✅ Sua conta será ativada</li>
                <li>🔐 Você poderá fazer login normalmente</li>
                <li>📊 Terá acesso completo ao sistema CRM</li>
              </ul>
            </div>
            <div class="footer">
              <p>Se você não criou esta conta, pode ignorar este email com segurança.</p>
              <p><strong>CRM AutoLead</strong> - Sua solução em gestão de vendas</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    console.log("✅ Confirmation email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ 
      success: true, 
      messageId: emailResponse.data?.id,
      message: "Email de confirmação enviado com sucesso" 
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("❌ Error sending confirmation email:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false 
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);