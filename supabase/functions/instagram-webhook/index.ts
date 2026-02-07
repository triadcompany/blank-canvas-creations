import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Bump this on every deploy to verify you're hitting the latest code
const VERSION = "ig-webhook@2026-02-02.1";
const DEPLOYED_AT = new Date().toISOString();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hub-signature-256',
};

serve(async (req) => {
  console.log(`[${VERSION}] Request: ${req.method} ${req.url}`);
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const url = new URL(req.url);

    // Webhook verification (GET request from Meta)
    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      const verifyToken = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') || 'autolead_instagram_verify';

      // Health check: lets you open the URL in the browser and confirm which code is deployed
      if (!mode && !token && !challenge) {
        return new Response(
          JSON.stringify({
            ok: true,
            name: 'instagram-webhook',
            version: VERSION,
            deployedAt: DEPLOYED_AT,
            hint: 'Meta verification will call this endpoint with hub.* query params.',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      if (mode === 'subscribe' && token === verifyToken) {
        console.log(`[${VERSION}] Webhook verified (mode=subscribe)`);
        return new Response(challenge, { status: 200, headers: corsHeaders });
      }

      console.log(
        `[${VERSION}] Webhook verification failed`,
        JSON.stringify({ mode, tokenReceived: token, tokenExpected: verifyToken, hasChallenge: !!challenge })
      );
      return new Response('Forbidden', { status: 403, headers: corsHeaders });
    }

    // Handle incoming webhook (POST request)
    if (req.method === 'POST') {
      const body = await req.json();
      console.log('Instagram webhook received:', JSON.stringify(body, null, 2));

      // Process messaging events
      if (body.object === 'instagram') {
        for (const entry of body.entry || []) {
          const messaging = entry.messaging || [];
          
          for (const event of messaging) {
            const senderId = event.sender?.id;
            const recipientId = event.recipient?.id;
            const message = event.message;
            const timestamp = event.timestamp;

            if (!senderId || !recipientId || !message) continue;

            // Find the Instagram connection for this page
            const { data: connection, error: connError } = await supabase
              .from('instagram_connections')
              .select('*, saas_organizations(id)')
              .eq('instagram_business_account_id', recipientId)
              .eq('is_active', true)
              .single();

            if (connError || !connection) {
              console.log('No active connection found for account:', recipientId);
              continue;
            }

            const organizationId = connection.organization_id;

            // Find or create conversation
            let { data: conversation, error: convError } = await supabase
              .from('instagram_conversations')
              .select('*')
              .eq('connection_id', connection.id)
              .eq('participant_id', senderId)
              .single();

            if (!conversation) {
              // Get sender profile info from Instagram API
              let participantName = null;
              let participantUsername = null;
              let participantPicture = null;

              try {
                const profileResponse = await fetch(
                  `https://graph.instagram.com/${senderId}?fields=username,name,profile_picture_url&access_token=${connection.page_access_token}`
                );
                if (profileResponse.ok) {
                  const profile = await profileResponse.json();
                  participantName = profile.name;
                  participantUsername = profile.username;
                  participantPicture = profile.profile_picture_url;
                }
              } catch (e) {
                console.log('Could not fetch participant profile:', e);
              }

              // Create new conversation
              const { data: newConv, error: newConvError } = await supabase
                .from('instagram_conversations')
                .insert({
                  organization_id: organizationId,
                  connection_id: connection.id,
                  instagram_conversation_id: `${senderId}_${recipientId}`,
                  participant_id: senderId,
                  participant_name: participantName,
                  participant_username: participantUsername,
                  participant_profile_picture: participantPicture,
                  status: 'open',
                  last_message_at: new Date(timestamp).toISOString(),
                })
                .select()
                .single();

              if (newConvError) {
                console.error('Error creating conversation:', newConvError);
                continue;
              }

              conversation = newConv;

              // Auto-distribute conversation
              await supabase.rpc('distribute_instagram_conversation', {
                p_conversation_id: conversation.id,
                p_organization_id: organizationId,
              });
            }

            // Save message
            const messageContent = message.text || '[Mídia]';
            const messageType = message.attachments?.[0]?.type || 'text';
            const mediaUrl = message.attachments?.[0]?.payload?.url;

            const { error: msgError } = await supabase
              .from('instagram_messages')
              .insert({
                conversation_id: conversation.id,
                instagram_message_id: message.mid,
                direction: 'incoming',
                content: messageContent,
                message_type: messageType,
                media_url: mediaUrl,
                sent_at: new Date(timestamp).toISOString(),
              });

            if (msgError) {
              console.error('Error saving message:', msgError);
            }

            // Update metrics
            await supabase
              .from('instagram_metrics')
              .upsert({
                organization_id: organizationId,
                user_id: conversation.assigned_to,
                date: new Date().toISOString().split('T')[0],
                messages_received: 1,
              }, {
                onConflict: 'organization_id,user_id,date',
                ignoreDuplicates: false,
              });
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  } catch (error) {
    console.error(`[${VERSION}] Instagram webhook error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
