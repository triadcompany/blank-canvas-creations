import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MetaEventPayload {
  lead_id: string;
  event_name: 'Lead' | 'Lead_Super_Qualificado' | 'Lead_Veio_Loja' | 'Purchase';
  stage_name?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { lead_id, event_name, stage_name } = await req.json() as MetaEventPayload;

    console.log(`[Meta Event] Processing: ${event_name} for lead ${lead_id}, stage: ${stage_name}`);

    // 1. Buscar dados do lead
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*, profiles!leads_seller_id_fkey(email, name)')
      .eq('id', lead_id)
      .single();

    if (leadError || !lead) {
      console.error('[Meta Event] Lead not found:', leadError);
      throw new Error('Lead não encontrado');
    }

    // 2. Buscar configuração Meta da organização
    const { data: metaConfig, error: configError } = await supabase
      .from('meta_integrations')
      .select('*')
      .eq('organization_id', lead.organization_id)
      .eq('is_active', true)
      .single();

    if (configError || !metaConfig) {
      console.log('[Meta Event] Meta integration not configured or inactive');
      return new Response(
        JSON.stringify({ ok: false, message: 'Meta integration not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Verificar se evento está habilitado
    const eventEnabledMap: Record<string, boolean> = {
      'Lead': metaConfig.track_lead_qualificado,
      'Lead_Super_Qualificado': metaConfig.track_lead_super_qualificado,
      'Purchase': metaConfig.track_lead_comprou,
      'Lead_Veio_Loja': metaConfig.track_lead_veio_loja,
    };

    const eventEnabled = eventEnabledMap[event_name];

    if (!eventEnabled) {
      console.log(`[Meta Event] Event ${event_name} is disabled for this organization`);
      return new Response(
        JSON.stringify({ ok: false, message: 'Event disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Criar event_id único (para deduplicação no Meta)
    const event_id = `${lead_id}_${event_name}_${Date.now()}`;
    const event_time = Math.floor(Date.now() / 1000);

    // 5. Montar user_data com dados hasheados (GDPR/LGPD compliant)
    const userData: Record<string, any> = {};

    if (lead.email) {
      userData.em = [await hashSHA256(lead.email.toLowerCase().trim())];
    }

    if (lead.phone) {
      const cleanPhone = lead.phone.replace(/\D/g, '');
      userData.ph = [await hashSHA256(cleanPhone)];
    }

    if (lead.name) {
      const nameParts = lead.name.trim().split(' ');
      userData.fn = [await hashSHA256(nameParts[0].toLowerCase())];
      if (nameParts.length > 1) {
        userData.ln = [await hashSHA256(nameParts[nameParts.length - 1].toLowerCase())];
      }
    }

    // 6. Montar custom_data
    const customData: Record<string, any> = {
      currency: 'BRL',
      content_category: 'Automotive',
    };

    // Adicionar valor apenas para Purchase
    if (event_name === 'Purchase' && lead.price) {
      const priceValue = parseFloat(lead.price.replace(/\D/g, '')) / 100;
      customData.value = priceValue;
    }

    if (lead.interest) {
      customData.content_name = lead.interest;
    }

    if (lead.source) {
      customData.lead_source = lead.source;
    }

    if (stage_name) {
      customData.lead_stage = stage_name;
    }

    // 7. Montar payload para Meta Conversions API
    const eventData = {
      event_name,
      event_time,
      event_id,
      event_source_url: 'https://autolead.lovable.app',
      action_source: 'other', // server-side event
      user_data: userData,
      custom_data: customData,
    };

    const payload: any = {
      data: [eventData],
    };

    // Adicionar test_event_code se em modo de teste
    if (metaConfig.test_mode) {
      payload.test_event_code = 'TEST12345';
      console.log('[Meta Event] Test mode enabled');
    }

    console.log(`[Meta Event] Sending to Meta Pixel ${metaConfig.pixel_id}:`, {
      event_name,
      lead_id,
      has_email: !!userData.em,
      has_phone: !!userData.ph,
      test_mode: metaConfig.test_mode,
    });

    // 8. Enviar para Meta Conversions API
    const metaUrl = `https://graph.facebook.com/v18.0/${metaConfig.pixel_id}/events?access_token=${metaConfig.access_token}`;

    const metaResponse = await fetch(metaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const metaResult = await metaResponse.json();

    console.log('[Meta Event] Meta API response:', metaResult);

    // 9. Logar evento no banco
    await supabase.from('meta_events_log').insert({
      organization_id: lead.organization_id,
      lead_id,
      event_name,
      event_id,
      event_time,
      payload: payload as any,
      response: metaResult as any,
      success: metaResponse.ok,
      error_message: !metaResponse.ok ? JSON.stringify(metaResult) : null,
    });

    if (!metaResponse.ok) {
      console.error('[Meta Event] Meta API error:', metaResult);
      throw new Error(`Meta API error: ${JSON.stringify(metaResult)}`);
    }

    console.log('[Meta Event] Event sent successfully');

    return new Response(
      JSON.stringify({ ok: true, meta_response: metaResult }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Meta Event] Error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

// Helper para hash SHA256 (Meta requer dados hasheados para privacidade)
async function hashSHA256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
