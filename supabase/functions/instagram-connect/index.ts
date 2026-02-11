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
    // Validate required env vars
    const required = ["META_APP_ID", "META_APP_SECRET"];
    const missing = required.filter(k => !Deno.env.get(k));
    if (missing.length > 0) {
      console.error("[instagram-connect] Missing env vars:", missing);
      return new Response(JSON.stringify({ error: "Configuração incompleta no servidor", missing }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse body
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { profileId, organizationId: bodyOrgId } = body;

    console.log("[instagram-connect] start", {
      method: req.method,
      action: body.action,
      profileId,
      bodyOrgId,
    });

    // Auth: identify user via profileId from body (Clerk-based auth)
    let userId: string | null = null;
    let organizationId: string | null = null;

    if (profileId) {
      // Verify profile exists and get org
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, user_id, organization_id')
        .eq('id', profileId)
        .single();

      if (profileError || !profile) {
        console.error("[instagram-connect] Profile not found:", profileId, profileError);
        return new Response(JSON.stringify({ error: 'Perfil não encontrado', code: 'PROFILE_NOT_FOUND' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      userId = profile.user_id || profile.id;
      organizationId = profile.organization_id;
    }

    // Fallback: try Supabase Auth header (for non-Clerk users)
    if (!userId) {
      const authHeader = req.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        const { data: authData } = await supabaseAdmin.auth.getUser(token);
        if (authData?.user) {
          userId = authData.user.id;
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('organization_id')
            .eq('user_id', userId)
            .single();
          organizationId = profile?.organization_id || null;
        }
      }
    }

    if (!userId) {
      console.error("[instagram-connect] Auth failed — no valid user found");
      return new Response(JSON.stringify({ error: 'Não autorizado. Faça login novamente.', code: 'AUTH_FAILED' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!organizationId) {
      return new Response(JSON.stringify({ error: 'Organização não encontrada para este usuário', code: 'NO_ORG' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return handleAction(body, userId, organizationId, supabaseAdmin, corsHeaders);

  } catch (error) {
    console.error('[instagram-connect] Unhandled error:', error);
    return new Response(JSON.stringify({ error: 'Erro interno', details: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleAction(
  body: any,
  userId: string,
  organizationId: string,
  supabaseAdmin: any,
  corsHeaders: Record<string, string>,
) {
  const { action, ...params } = body;
  console.log("[instagram-connect] action:", action, "userId:", userId, "orgId:", organizationId);

  switch (action) {
    case 'get_oauth_url': {
      const appId = Deno.env.get('META_APP_ID')!;
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const redirectUri = params.redirectUri || 'https://autolead.lovable.app/settings?tab=instagram&callback=true';

      const scope = 'instagram_basic,instagram_manage_messages,pages_show_list,pages_read_engagement';

      const state = btoa(JSON.stringify({ userId, organizationId }));

      const oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
        `client_id=${appId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${scope}` +
        `&response_type=code` +
        `&state=${state}`;

      console.log("[instagram-connect] Generated OAuth URL for user", userId);
      return new Response(JSON.stringify({ url: oauthUrl }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    case 'exchange_code': {
      const { code, redirectUri } = params;
      const appId = Deno.env.get('META_APP_ID')!;
      const appSecret = Deno.env.get('META_APP_SECRET')!;

      const tokenResponse = await fetch(
        `https://graph.facebook.com/v18.0/oauth/access_token?` +
        `client_id=${appId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&client_secret=${appSecret}` +
        `&code=${code}`
      );

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error("[instagram-connect] Token exchange failed:", tokenData);
        return new Response(JSON.stringify({ error: 'Falha ao trocar código', details: tokenData }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const longTokenResponse = await fetch(
        `https://graph.facebook.com/v18.0/oauth/access_token?` +
        `grant_type=fb_exchange_token` +
        `&client_id=${appId}` +
        `&client_secret=${appSecret}` +
        `&fb_exchange_token=${tokenData.access_token}`
      );

      const longTokenData = await longTokenResponse.json();

      const pagesResponse = await fetch(
        `https://graph.facebook.com/v18.0/me/accounts?` +
        `fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}` +
        `&access_token=${longTokenData.access_token}`
      );

      const pagesData = await pagesResponse.json();

      if (!pagesData.data || pagesData.data.length === 0) {
        return new Response(JSON.stringify({ error: 'Nenhuma página com conta Instagram encontrada' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

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
        return new Response(JSON.stringify({ error: 'Dados da página inválidos' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await supabaseAdmin.from('social_integrations').upsert({
        organization_id: organizationId,
        platform: 'instagram',
        page_id: page.id,
        page_name: page.name,
        access_token: page.access_token,
        status: 'active',
      }, { onConflict: 'organization_id,platform,page_id' });

      const { data: connection, error: saveError } = await supabaseAdmin
        .from('instagram_connections')
        .upsert({
          organization_id: organizationId,
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
        console.error("[instagram-connect] Save error:", saveError);
        return new Response(JSON.stringify({ error: 'Falha ao salvar conexão', details: saveError }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

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

      console.log("[instagram-connect] Connection saved:", connection.id);
      return new Response(JSON.stringify({ success: true, connection }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    default:
      return new Response(JSON.stringify({ error: `Ação inválida: ${action}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
  }
}