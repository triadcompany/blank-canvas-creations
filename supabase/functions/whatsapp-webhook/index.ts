import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Received WhatsApp webhook request');
    
    const url = new URL(req.url);
    const webhookToken = url.pathname.split('/').pop();
    
    console.log('Webhook token:', webhookToken);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    let body;
    const requestText = await req.text();
    const debugWebhook = Deno.env.get('DEBUG_WEBHOOK') === 'true';
    if (debugWebhook) {
      console.log('Raw request body:', requestText);
    } else {
      console.log('Webhook body received', { bytes: requestText.length });
    }

    if (!requestText || requestText.trim() === '') {
      console.log('Empty request body');
      return new Response(JSON.stringify({ error: 'Empty request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      body = JSON.parse(requestText);
    } catch (parseError) {
      console.log('JSON parse error:', parseError);
      return new Response(JSON.stringify({ error: 'Invalid JSON format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (debugWebhook) {
      console.log('Webhook payload:', JSON.stringify(body, null, 2));
    } else {
      console.log('Webhook event', { event: body?.event, instance: body?.instance });
    }

    // Extrair informações da mensagem WhatsApp
    let contactName, contactPhone, messageText;
    
    if (body.contact && body.phone) {
      contactName = typeof body.contact === 'string' ? body.contact : (body.contact.name || body.contact.pushName);
      contactPhone = body.phone;
      messageText = body.message || body.observations;
    } else if (body.nome && body.telefone) {
      contactName = body.nome;
      contactPhone = body.telefone;
      messageText = body.mensagem;
    } else if (body.contact && (body.contact.phone || body.contact.number)) {
      contactName = body.contact.name || body.contact.pushName;
      contactPhone = body.contact.phone || body.contact.number;
      messageText = body.message || body.observations;
    } else {
      console.log('Missing contact or phone information in payload:', body);
      return new Response(JSON.stringify({ error: 'Missing contact or phone information' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalizar telefone
    let normalizedPhone = contactPhone.replace('@s.whatsapp.net', '');
    normalizedPhone = normalizedPhone.replace(/\D/g, '');
    if (!normalizedPhone.startsWith('55') && normalizedPhone.length >= 10) {
      normalizedPhone = '55' + normalizedPhone;
    }
    console.log('Normalized phone:', normalizedPhone, 'from original:', contactPhone);
    
    if (!contactName || !normalizedPhone) {
      console.log('Missing contact name or phone after processing');
      return new Response(JSON.stringify({ error: 'Missing contact name or phone' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Buscar integração do WhatsApp
    if (!webhookToken) {
      console.log('Missing webhook token in URL');
      return new Response(JSON.stringify({ error: 'Missing webhook token' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('whatsapp_integrations')
      .select('*')
      .eq('webhook_token', webhookToken)
      .eq('is_active', true)
      .maybeSingle();

    if (integrationError) {
      console.log('Error fetching WhatsApp integration:', integrationError);
      return new Response(JSON.stringify({ error: 'Database error fetching integration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!integration) {
      console.log('WhatsApp integration not found');
      return new Response(JSON.stringify({ error: 'WhatsApp integration not configured' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Found integration for organization:', integration.organization_id);

    // Buscar organização para verificar o nome
    const { data: organization } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', integration.organization_id)
      .single();

    // Lógica especial para Juccar
    let pipeline, pipelineError, firstStage, stageError;
    
    if (organization?.name?.toLowerCase().includes('juccar')) {
      console.log('Juccar organization detected, using specific pipeline and stage');
      
      // Buscar pipeline "juccar"
      const pipelineResult = await supabaseAdmin
        .from('pipelines')
        .select('id, name')
        .eq('organization_id', integration.organization_id)
        .ilike('name', '%juccar%')
        .eq('is_active', true)
        .maybeSingle();
      
      pipeline = pipelineResult.data;
      pipelineError = pipelineResult.error;

      if (pipeline) {
        // Buscar stage "Novo Lead" especificamente
        const stageResult = await supabaseAdmin
          .from('pipeline_stages')
          .select('id, name')
          .eq('pipeline_id', pipeline.id)
          .ilike('name', '%novo lead%')
          .eq('is_active', true)
          .maybeSingle();
        
        firstStage = stageResult.data;
        stageError = stageResult.error;
        
        if (!firstStage) {
          console.log('Stage "Novo Lead" not found, falling back to first stage');
          const fallbackStage = await supabaseAdmin
            .from('pipeline_stages')
            .select('id, name')
            .eq('pipeline_id', pipeline.id)
            .eq('position', 1)
            .eq('is_active', true)
            .maybeSingle();
          
          firstStage = fallbackStage.data;
          stageError = fallbackStage.error;
        }
      }
    } else {
      // Lógica padrão para outras organizações
      const pipelineResult = await supabaseAdmin
        .from('pipelines')
        .select('id, name')
        .eq('organization_id', integration.organization_id)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      pipeline = pipelineResult.data;
      pipelineError = pipelineResult.error;

      if (pipeline) {
        const stageResult = await supabaseAdmin
          .from('pipeline_stages')
          .select('id, name')
          .eq('pipeline_id', pipeline.id)
          .eq('position', 1)
          .eq('is_active', true)
          .maybeSingle();
        
        firstStage = stageResult.data;
        stageError = stageResult.error;
      }
    }

    if (pipelineError || !pipeline) {
      console.log('Pipeline not found for organization:', integration.organization_id);
      return new Response(JSON.stringify({ error: 'Pipeline not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Using pipeline:', pipeline.name, 'for organization:', integration.organization_id);

    if (stageError || !firstStage) {
      console.log('First pipeline stage not found for pipeline:', pipeline.id);
      return new Response(JSON.stringify({ error: 'Pipeline stage not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Using stage:', firstStage.name, 'as entry point for new leads');

    // Criar external_id único para idempotência
    const externalId = `whatsapp_${normalizedPhone}_${Date.now()}`;
    
    // Verificar se já foi processado (idempotência por external_id)
    const { data: existingInbox } = await supabaseAdmin
      .from('lead_inbox')
      .select('id, lead_id, status')
      .eq('external_id', externalId)
      .maybeSingle();

    if (existingInbox) {
      console.log('Lead inbox entry already exists, skipping duplicate');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Lead já foi processado anteriormente',
          inboxId: existingInbox.id,
          leadId: existingInbox.lead_id,
          duplicate: true
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
    }

    // Obter um profile_id válido da organização
    const { data: orgProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id')
      .eq('organization_id', integration.organization_id)
      .limit(1)
      .single();

    if (profileError || !orgProfile) {
      console.error('No profile found for organization:', integration.organization_id);
      throw new Error('Organization has no users');
    }

    // VERIFICAR se lead já existe (garantindo idempotência)
    const { data: existingLead } = await supabaseAdmin
      .from('leads')
      .select('id, name, observations')
      .eq('phone', normalizedPhone)
      .eq('organization_id', integration.organization_id)
      .maybeSingle();

    let leadId: string;
    let isNewLead = false;

    if (existingLead) {
      // Lead EXISTE - apenas atualizar observações
      console.log('Lead already exists, appending message:', existingLead.id);
      
      const timestamp = `[WhatsApp ${new Date().toLocaleString('pt-BR')}]`;
      const newMessage = `${timestamp}\n${messageText || 'Mensagem recebida'}`;
      
      // Limitar tamanho das observações (máx 8000 caracteres)
      const currentObs = existingLead.observations || '';
      const maxLength = 8000;
      
      let updatedObs: string;
      if (currentObs.length + newMessage.length + 4 <= maxLength) {
        updatedObs = currentObs ? `${currentObs}\n\n${newMessage}` : newMessage;
      } else {
        // Truncar observações antigas mantendo as últimas
        const keepLength = maxLength - newMessage.length - 100;
        const truncatedObs = currentObs.substring(Math.max(0, currentObs.length - keepLength));
        updatedObs = `...(truncado)\n\n${truncatedObs}\n\n${newMessage}`;
      }

      const { error: updateError } = await supabaseAdmin
        .from('leads')
        .update({ 
          observations: updatedObs,
          name: contactName || existingLead.name
        })
        .eq('id', existingLead.id);

      if (updateError) {
        console.error('Error updating lead observations:', updateError);
        throw updateError;
      }

      leadId = existingLead.id;
      console.log('Lead observations updated successfully');
    } else {
      // Lead NÃO EXISTE - criar novo
      isNewLead = true;
      console.log('Creating new lead for phone:', normalizedPhone);

      // Criar lead SEM seller_id inicialmente - será definido pela distribuição
      const leadData = {
        name: contactName || 'WhatsApp Lead',
        phone: normalizedPhone,
        email: null,
        source: 'WhatsApp',
        interest: messageText ? messageText.substring(0, 200) : 'Contato via WhatsApp',
        observations: `Criado via WhatsApp em ${new Date().toLocaleString('pt-BR')}\nTelefone: ${contactPhone}\n\nPrimeira mensagem:\n${messageText || 'Contato inicial'}`,
        organization_id: integration.organization_id,
        stage_id: firstStage.id,
        seller_id: orgProfile.id, // Fallback temporário, será atualizado pela distribuição
        created_by: orgProfile.id,
      };

      const { data: newLead, error: leadError } = await supabaseAdmin
        .from('leads')
        .insert(leadData)
        .select()
        .single();

      if (leadError) {
        // Se erro for violação de constraint único (23505), outro request criou o lead
        if (leadError.code === '23505') {
          console.log('Concurrent insert detected, fetching existing lead...');
          
          const { data: concurrentLead } = await supabaseAdmin
            .from('leads')
            .select('id')
            .eq('phone', normalizedPhone)
            .eq('organization_id', integration.organization_id)
            .single();
          
          if (concurrentLead) {
            leadId = concurrentLead.id;
            isNewLead = false;
            console.log('Using lead created by concurrent request:', leadId);
          } else {
            throw new Error('Lead creation failed and could not find existing lead');
          }
        } else {
          console.error('Error creating lead:', leadError);
          throw leadError;
        }
      } else {
        leadId = newLead.id;
        console.log('New lead created successfully:', leadId);
      }
    }

    // Registrar no lead_inbox
    const { error: inboxError } = await supabaseAdmin
      .from('lead_inbox')
      .insert({
        external_id: externalId,
        payload: { contact: body.contact, message: body.message, phone: contactPhone },
        lead_id: leadId,
        status: 'novo'
      });

    if (inboxError) {
      console.error('Error creating lead inbox entry:', inboxError);
    }

    // Distribuir o lead usando a função do banco
    let assignedUserId: string | null = null;
    
    try {
      const { data: distributionResult, error: distributionError } = await supabaseAdmin
        .rpc('distribute_lead', {
          p_lead_id: leadId,
          p_organization_id: integration.organization_id
        });

      if (distributionError) {
        console.error('Distribution error:', distributionError);
        throw distributionError;
      }

      if (distributionResult) {
        console.log('Distribution result:', distributionResult);
        
        if (distributionResult.already_assigned) {
          console.log('Lead already assigned, skipping duplicate assignment');
        } else {
          assignedUserId = distributionResult.assigned_user_id;
          console.log('Lead distributed successfully to user:', assignedUserId);
        }
      }
    } catch (error) {
      console.error('Error in lead distribution:', error);
      // Fallback para admin se a distribuição falhar
      const { data: adminUser } = await supabaseAdmin
        .from('user_roles')
        .select('user_id')
        .eq('organization_id', integration.organization_id)
        .eq('role', 'admin')
        .limit(1)
        .single();

      if (adminUser) {
        assignedUserId = adminUser.user_id;
        console.log('Fallback: assigned to admin:', assignedUserId);
      }
    }

    // Atualizar status no lead_inbox
    await supabaseAdmin
      .from('lead_inbox')
      .update({ status: assignedUserId ? 'atribuido' : 'erro' })
      .eq('external_id', externalId);

    // Fire automation trigger for new leads
    if (isNewLead) {
      try {
        const triggerUrl = `${supabaseUrl}/functions/v1/automation-trigger`;
        await fetch(triggerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            organization_id: integration.organization_id,
            lead_id: leadId,
            trigger_type: "lead_created",
          }),
        });
        console.log("Automation trigger fired for new lead:", leadId);
      } catch (triggerErr) {
        console.error("Error firing automation trigger:", triggerErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: existingLead ? 'Lead atualizado com sucesso' : 'Lead criado e distribuído com sucesso',
        leadId: leadId,
        assignedUserId: assignedUserId,
        updated: !!existingLead
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error processing webhook:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
