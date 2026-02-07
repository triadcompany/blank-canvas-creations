import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

    const token = authHeader.replace('Bearer ', '');
    
    // Validate the JWT using the admin client
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized', details: authError?.message }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;

    // Check if user is admin
    const { data: userRole } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (userRole?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's organization
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id')
      .eq('user_id', userId)
      .single();

    if (!profile?.organization_id) {
      return new Response(JSON.stringify({ error: 'Organization not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, ...params } = await req.json();

    switch (action) {
      case 'get_oauth_url': {
        const appId = Deno.env.get('META_APP_ID');
        const redirectUri = params.redirectUri || `${supabaseUrl}/functions/v1/instagram-connect`;
        
        if (!appId) {
          return new Response(JSON.stringify({ error: 'META_APP_ID not configured. Please add META_APP_ID to your Supabase secrets.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const scope = [
          'instagram_basic',
          'instagram_manage_messages',
          'pages_manage_metadata',
          'pages_messaging',
          'pages_read_engagement',
        ].join(',');

        const state = btoa(JSON.stringify({
          userId,
          organizationId: profile.organization_id,
        }));

        const oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
          `client_id=${appId}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&scope=${scope}` +
          `&response_type=code` +
          `&state=${state}`;

        return new Response(JSON.stringify({ url: oauthUrl }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'exchange_code': {
        const { code, redirectUri } = params;
        const appId = Deno.env.get('META_APP_ID');
        const appSecret = Deno.env.get('META_APP_SECRET');

        if (!appId || !appSecret) {
          return new Response(JSON.stringify({ error: 'Meta app credentials not configured' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Exchange code for short-lived token
        const tokenResponse = await fetch(
          `https://graph.facebook.com/v18.0/oauth/access_token?` +
          `client_id=${appId}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&client_secret=${appSecret}` +
          `&code=${code}`
        );

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
          return new Response(JSON.stringify({ error: 'Failed to exchange code', details: tokenData }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Exchange for long-lived token
        const longTokenResponse = await fetch(
          `https://graph.facebook.com/v18.0/oauth/access_token?` +
          `grant_type=fb_exchange_token` +
          `&client_id=${appId}` +
          `&client_secret=${appSecret}` +
          `&fb_exchange_token=${tokenData.access_token}`
        );

        const longTokenData = await longTokenResponse.json();

        // Get pages with Instagram accounts
        const pagesResponse = await fetch(
          `https://graph.facebook.com/v18.0/me/accounts?` +
          `fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}` +
          `&access_token=${longTokenData.access_token}`
        );

        const pagesData = await pagesResponse.json();

        if (!pagesData.data || pagesData.data.length === 0) {
          return new Response(JSON.stringify({ error: 'No Facebook pages with Instagram accounts found' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Filter pages with Instagram accounts
        const pagesWithInstagram = pagesData.data.filter(
          (page: any) => page.instagram_business_account
        );

        return new Response(JSON.stringify({ pages: pagesWithInstagram }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save_connection': {
        const { page } = params;

        if (!page?.instagram_business_account?.id || !page?.access_token) {
          return new Response(JSON.stringify({ error: 'Invalid page data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Save connection
        const { data: connection, error: saveError } = await supabaseAdmin
          .from('instagram_connections')
          .upsert({
            organization_id: profile.organization_id,
            instagram_business_account_id: page.instagram_business_account.id,
            page_id: page.id,
            page_name: page.name,
            page_access_token: page.access_token,
            instagram_username: page.instagram_business_account.username,
            profile_picture_url: page.instagram_business_account.profile_picture_url,
            is_active: true,
            connected_by: userId,
          }, {
            onConflict: 'organization_id,instagram_business_account_id',
          })
          .select()
          .single();

        if (saveError) {
          return new Response(JSON.stringify({ error: 'Failed to save connection', details: saveError }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Grant admin user permission by default
        await supabaseAdmin
          .from('instagram_user_permissions')
          .upsert({
            connection_id: connection.id,
            user_id: userId,
            can_view: true,
            can_respond: true,
            can_transfer: true,
            granted_by: userId,
          }, {
            onConflict: 'connection_id,user_id',
          });

        return new Response(JSON.stringify({ success: true, connection }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('Instagram connect error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});