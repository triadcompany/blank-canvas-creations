import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  // Create client with service role for database operations
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Validate auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authError } = await supabase.auth.getClaims(token);
    
    if (authError || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = claims.claims.sub;

    const { conversationId, message, quickReplyId } = await req.json();

    if (!conversationId || !message) {
      return new Response(JSON.stringify({ error: 'conversationId and message are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get conversation with connection details
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('instagram_conversations')
      .select(`
        *,
        instagram_connections(*)
      `)
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const connection = conversation.instagram_connections;

    // Check if user has permission
    const { data: permission } = await supabaseAdmin
      .from('instagram_user_permissions')
      .select('*')
      .eq('connection_id', connection.id)
      .eq('user_id', userId)
      .eq('can_respond', true)
      .single();

    // Check if user is admin or has permission
    const { data: userRole } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();

    const isAdmin = userRole?.role === 'admin';
    const isAssigned = conversation.assigned_to === userId;

    if (!isAdmin && !permission && !isAssigned) {
      return new Response(JSON.stringify({ error: 'No permission to respond' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send message via Instagram API
    const instagramResponse = await fetch(
      `https://graph.instagram.com/v18.0/${connection.instagram_business_account_id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${connection.page_access_token}`,
        },
        body: JSON.stringify({
          recipient: {
            id: conversation.participant_id,
          },
          message: {
            text: message,
          },
        }),
      }
    );

    const instagramResult = await instagramResponse.json();

    if (!instagramResponse.ok) {
      console.error('Instagram API error:', instagramResult);
      return new Response(JSON.stringify({ 
        error: 'Failed to send message', 
        details: instagramResult 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Save message to database
    const { data: savedMessage, error: saveError } = await supabaseAdmin
      .from('instagram_messages')
      .insert({
        conversation_id: conversationId,
        instagram_message_id: instagramResult.message_id,
        direction: 'outgoing',
        content: message,
        message_type: 'text',
        sent_by: userId,
        sent_at: new Date().toISOString(),
        is_quick_reply: !!quickReplyId,
        quick_reply_id: quickReplyId,
      })
      .select()
      .single();

    if (saveError) {
      console.error('Error saving message:', saveError);
    }

    // Update quick reply usage count if used
    if (quickReplyId) {
      await supabaseAdmin
        .from('instagram_quick_replies')
        .update({ usage_count: conversation.instagram_quick_replies?.usage_count + 1 || 1 })
        .eq('id', quickReplyId);
    }

    // Update metrics
    await supabaseAdmin
      .from('instagram_metrics')
      .upsert({
        organization_id: conversation.organization_id,
        user_id: userId,
        date: new Date().toISOString().split('T')[0],
        messages_sent: 1,
      }, {
        onConflict: 'organization_id,user_id,date',
        ignoreDuplicates: false,
      });

    return new Response(JSON.stringify({ 
      success: true, 
      message: savedMessage,
      instagram_message_id: instagramResult.message_id,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Send message error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
