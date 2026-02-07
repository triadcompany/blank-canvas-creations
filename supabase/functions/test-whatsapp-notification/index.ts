import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TestPayload {
  to: string;
  message: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get authenticated user
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Get user's profile to get organization_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      throw new Error('Profile not found');
    }

    // Get WhatsApp integration settings
    const { data: integration, error: integrationError } = await supabase
      .from('whatsapp_integrations')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .eq('is_active', true)
      .maybeSingle();

    if (integrationError) {
      throw integrationError;
    }

    if (!integration || !integration.n8n_webhook_evolution_notify) {
      throw new Error('WhatsApp integration not configured or n8n webhook not set');
    }

    // Parse request body
    const { to, message }: TestPayload = await req.json();

    if (!to || !message) {
      throw new Error('Missing required fields: to, message');
    }

    console.log(`Sending test message to: ${to}`);

    // Send to n8n webhook
    const n8nPayload = {
      event: "test_notification",
      evolution_instance: integration.evolution_instance_id,
      evolution_api_key: integration.evolution_api_key,
      to: to,
      message: message,
      test: true,
      timestamp: new Date().toISOString()
    };

    const n8nResponse = await fetch(integration.n8n_webhook_evolution_notify, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(n8nPayload)
    });

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text();
      console.error('n8n webhook error:', errorText);
      throw new Error(`n8n webhook failed: ${n8nResponse.status}`);
    }

    // Log test notification
    await supabase
      .from('lead_distribution_audit')
      .insert({
        event: 'test_notification',
        data: {
          to: to,
          message: message,
          test: true,
          status: 'sent',
          timestamp: new Date().toISOString()
        }
      });

    console.log(`Test notification sent successfully to ${to}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Test notification sent successfully'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error: any) {
    console.error('Error in test-whatsapp-notification:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});
