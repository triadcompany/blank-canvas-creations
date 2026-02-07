import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface FollowupToProcess {
  id: string
  organization_id: string
  lead_id: string
  assigned_to: string
  channel: string
  template_id: string | null
  message_custom: string | null
  lead: {
    id: string
    name: string
    phone: string
    email: string | null
  }
  template: {
    id: string
    content: string
    variables: string[]
  } | null
  assigned_user: {
    id: string
    name: string
  }
}

interface WhatsAppConfig {
  id: string
  organization_id: string
  evolution_instance_id: string
  evolution_api_key: string
  is_active: boolean
  n8n_webhook_evolution_notify: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    // Check if current time is within commercial hours (09:00 - 19:00)
    const now = new Date()
    const currentHour = now.getHours()
    
    if (currentHour < 9 || currentHour >= 19) {
      console.log('Outside commercial hours (09:00-19:00), skipping processing')
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Outside commercial hours',
          processed: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch pending followups scheduled for now or past
    const { data: pendingFollowups, error: fetchError } = await supabase
      .from('followups')
      .select(`
        id,
        organization_id,
        lead_id,
        assigned_to,
        channel,
        template_id,
        message_custom,
        lead:leads!lead_id(id, name, phone, email),
        template:followup_templates!template_id(id, content, variables),
        assigned_user:profiles!assigned_to(id, name)
      `)
      .eq('status', 'PENDENTE')
      .lte('scheduled_for', now.toISOString())
      .limit(50)

    if (fetchError) {
      console.error('Error fetching followups:', fetchError)
      throw fetchError
    }

    if (!pendingFollowups || pendingFollowups.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No pending followups',
          processed: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Found ${pendingFollowups.length} pending followups to process`)

    // Group by organization to fetch WhatsApp configs once per org
    const orgIds = [...new Set(pendingFollowups.map(f => f.organization_id))]
    
    const { data: whatsappConfigs, error: configError } = await supabase
      .from('whatsapp_integrations')
      .select('id, organization_id, evolution_instance_id, evolution_api_key, is_active, n8n_webhook_evolution_notify')
      .in('organization_id', orgIds)
      .eq('is_active', true)

    if (configError) {
      console.error('Error fetching WhatsApp configs:', configError)
    }

    const configMap = new Map<string, WhatsAppConfig>()
    whatsappConfigs?.forEach(config => {
      configMap.set(config.organization_id, config)
    })

    const results = {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    }

    for (const followup of pendingFollowups as unknown as FollowupToProcess[]) {
      results.processed++

      try {
        // Validate lead has phone
        if (!followup.lead?.phone) {
          console.log(`Followup ${followup.id}: Lead has no phone, skipping`)
          await markFollowupStatus(supabase, followup.id, 'PULADO', 'Lead sem telefone')
          results.skipped++
          continue
        }

        // Get WhatsApp config for this organization
        const config = configMap.get(followup.organization_id)
        
        if (!config || !config.evolution_instance_id || !config.evolution_api_key) {
          console.log(`Followup ${followup.id}: No WhatsApp config for org, skipping`)
          await markFollowupStatus(supabase, followup.id, 'PULADO', 'WhatsApp não configurado')
          results.skipped++
          continue
        }

        // Build message content
        let messageContent = followup.message_custom || followup.template?.content || ''
        
        if (!messageContent) {
          console.log(`Followup ${followup.id}: No message content, skipping`)
          await markFollowupStatus(supabase, followup.id, 'PULADO', 'Sem conteúdo de mensagem')
          results.skipped++
          continue
        }

        // Replace variables in message
        messageContent = replaceVariables(messageContent, {
          nome: followup.lead.name,
          telefone: followup.lead.phone,
          email: followup.lead.email || '',
          vendedor: followup.assigned_user?.name || '',
        })

        // Send via Evolution API
        const sendResult = await sendWhatsAppMessage(
          config,
          followup.lead.phone,
          messageContent
        )

        if (sendResult.success) {
          // Update followup as sent
          await supabase
            .from('followups')
            .update({
              status: 'ENVIADO',
              sent_at: new Date().toISOString(),
              sent_by: 'AUTO',
              updated_at: new Date().toISOString(),
            })
            .eq('id', followup.id)

          // Log the message
          await supabase
            .from('message_logs')
            .insert({
              organization_id: followup.organization_id,
              lead_id: followup.lead_id,
              followup_id: followup.id,
              direction: 'outbound',
              channel: followup.channel,
              content: messageContent,
              provider_message_id: sendResult.messageId,
              status: 'sent',
            })

          results.sent++
          console.log(`Followup ${followup.id}: Message sent successfully`)
        } else {
          await markFollowupStatus(supabase, followup.id, 'FALHOU', sendResult.error || 'Erro ao enviar')
          
          // Log the failed attempt
          await supabase
            .from('message_logs')
            .insert({
              organization_id: followup.organization_id,
              lead_id: followup.lead_id,
              followup_id: followup.id,
              direction: 'outbound',
              channel: followup.channel,
              content: messageContent,
              status: 'failed',
              error_message: sendResult.error,
            })

          results.failed++
          console.log(`Followup ${followup.id}: Failed to send - ${sendResult.error}`)
        }
      } catch (error) {
        console.error(`Error processing followup ${followup.id}:`, error)
        await markFollowupStatus(supabase, followup.id, 'FALHOU', String(error))
        results.failed++
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Processing complete',
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in process-followups:', error)
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function markFollowupStatus(
  supabase: any, 
  followupId: string, 
  status: string, 
  notes: string
) {
  await supabase
    .from('followups')
    .update({
      status,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', followupId)
}

function replaceVariables(content: string, variables: Record<string, string>): string {
  let result = content
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'gi'), value)
  }
  return result
}

async function sendWhatsAppMessage(
  config: WhatsAppConfig,
  phone: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    // Clean phone number (remove non-digits)
    const cleanPhone = phone.replace(/\D/g, '')
    
    // If n8n webhook is configured, use it (preferred for more flexibility)
    if (config.n8n_webhook_evolution_notify) {
      const response = await fetch(config.n8n_webhook_evolution_notify, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanPhone,
          message: message,
          instance: config.evolution_instance_id,
          type: 'followup',
        }),
      })

      if (response.ok) {
        const data = await response.json()
        return { success: true, messageId: data.messageId || 'n8n-sent' }
      } else {
        const errorText = await response.text()
        return { success: false, error: `n8n webhook error: ${errorText}` }
      }
    }

    // Direct Evolution API call
    // Evolution API endpoint format: https://api.evolution.com/message/sendText/{instance}
    const evolutionBaseUrl = Deno.env.get('EVOLUTION_API_URL') || 'https://api.evolution.com'
    
    const response = await fetch(
      `${evolutionBaseUrl}/message/sendText/${config.evolution_instance_id}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.evolution_api_key,
        },
        body: JSON.stringify({
          number: cleanPhone,
          text: message,
        }),
      }
    )

    if (response.ok) {
      const data = await response.json()
      return { success: true, messageId: data.key?.id || data.messageId }
    } else {
      const errorText = await response.text()
      return { success: false, error: `Evolution API error: ${errorText}` }
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
