import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotifyPayload {
  lead_id: string;
  assigned_user_id: string;
  organization_id: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: NotifyPayload = await req.json();
    console.log('Processing lead assignment notification:', payload);

    // 1. Buscar dados do usuário atribuído
    const { data: userProfile, error: userError } = await supabase
      .from('profiles')
      .select('name, whatsapp_e164')
      .eq('user_id', payload.assigned_user_id)
      .single();

    if (userError || !userProfile) {
      console.error('Error fetching user profile:', userError);
      throw new Error('Usuário não encontrado');
    }

    // 2. Buscar dados do lead
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('name, phone, interest, source, price')
      .eq('id', payload.lead_id)
      .single();

    if (leadError || !lead) {
      console.error('Error fetching lead:', leadError);
      throw new Error('Lead não encontrado');
    }

    // 3. Buscar configurações da integração WhatsApp
    const { data: integration, error: integrationError } = await supabase
      .from('whatsapp_integrations')
      .select('evolution_instance_id, evolution_api_key, n8n_webhook_evolution_notify')
      .eq('organization_id', payload.organization_id)
      .eq('is_active', true)
      .single();

    if (integrationError || !integration) {
      console.log('WhatsApp integration not configured or inactive');
      
      // Registrar no audit que não foi possível enviar
      await supabase.from('lead_distribution_audit').insert({
        event: 'lead.assigned_notify',
        data: {
          lead_id: payload.lead_id,
          user_id: payload.assigned_user_id,
          status: 'error',
          message: 'Integração WhatsApp não configurada',
        },
      });

      return new Response(
        JSON.stringify({ 
          ok: false, 
          message: 'Integração WhatsApp não configurada' 
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // 4. Verificar se usuário tem WhatsApp cadastrado
    if (!userProfile.whatsapp_e164) {
      console.log('User does not have WhatsApp registered');
      
      await supabase.from('lead_distribution_audit').insert({
        event: 'lead.assigned_notify',
        data: {
          lead_id: payload.lead_id,
          user_id: payload.assigned_user_id,
          status: 'error',
          message: 'Usuário sem WhatsApp cadastrado',
        },
      });

      return new Response(
        JSON.stringify({ 
          ok: false, 
          message: 'Usuário sem WhatsApp cadastrado' 
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // 5. Verificar se n8n webhook está configurado
    if (!integration.n8n_webhook_evolution_notify) {
      console.log('n8n webhook not configured');
      
      await supabase.from('lead_distribution_audit').insert({
        event: 'lead.assigned_notify',
        data: {
          lead_id: payload.lead_id,
          user_id: payload.assigned_user_id,
          status: 'error',
          message: 'Webhook n8n não configurado',
        },
      });

      return new Response(
        JSON.stringify({ 
          ok: false, 
          message: 'Webhook n8n não configurado' 
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // 6. Montar mensagem
    const messageBody = `🚀 Novo lead atribuído a você!

Nome: ${lead.name || 'Sem nome'}
Telefone: ${lead.phone || '-'}
Interesse: ${lead.interest || lead.source || '-'}${lead.price ? `\nValor: ${lead.price}` : ''}`;

    // 7. Enviar para n8n
    const n8nPayload = {
      event: 'lead.assigned_notify',
      evolution_instance: integration.evolution_instance_id,
      evolution_api_key: integration.evolution_api_key,
      to: userProfile.whatsapp_e164,
      message: messageBody,
      lead_id: payload.lead_id,
      user_id: payload.assigned_user_id,
    };

    console.log('Sending notification to n8n:', {
      webhook: integration.n8n_webhook_evolution_notify,
      to: userProfile.whatsapp_e164,
    });

    const n8nResponse = await fetch(integration.n8n_webhook_evolution_notify, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(n8nPayload),
    });

    const n8nResult = await n8nResponse.text();
    console.log('n8n response:', { status: n8nResponse.status, body: n8nResult });

    // 8. Registrar no audit
    await supabase.from('lead_distribution_audit').insert({
      event: 'lead.assigned_notify',
      data: {
        lead_id: payload.lead_id,
        user_id: payload.assigned_user_id,
        to: userProfile.whatsapp_e164,
        status: n8nResponse.ok ? 'sent' : 'error',
        n8n_status: n8nResponse.status,
        message: messageBody,
      },
    });

    return new Response(
      JSON.stringify({ 
        ok: true, 
        message: 'Notificação enviada com sucesso',
        n8n_status: n8nResponse.status,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in notify-lead-assignment:', error);
    
    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
