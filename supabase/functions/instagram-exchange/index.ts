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

  const headers = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const appId = Deno.env.get('META_APP_ID');
    const appSecret = Deno.env.get('META_APP_SECRET');

    if (!appId || !appSecret) {
      console.error("[instagram-exchange] Missing META_APP_ID or META_APP_SECRET");
      return new Response(JSON.stringify({ error: 'Configuração incompleta no servidor' }), { status: 500, headers });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
    }

    const { code, state, organizationId, profileId } = body;
    console.log("[instagram-exchange] start", { profileId, organizationId, hasCode: !!code, hasState: !!state });

    if (!code || !organizationId || !profileId) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios: code, organizationId, profileId' }), { status: 400, headers });
    }

    // Validate profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, organization_id')
      .eq('id', profileId)
      .single();

    if (profileError || !profile) {
      console.error("[instagram-exchange] Profile not found:", profileId);
      return new Response(JSON.stringify({ error: 'Perfil não encontrado' }), { status: 401, headers });
    }

    if (profile.organization_id !== organizationId) {
      console.error("[instagram-exchange] Org mismatch", { profile: profile.organization_id, body: organizationId });
      return new Response(JSON.stringify({ error: 'Organização não corresponde ao perfil' }), { status: 403, headers });
    }

    const userId = profile.user_id || profile.id;
    const redirectUri = 'https://autolead.lovable.app/settings?tab=instagram&callback=true';

    // Step 1: Exchange code for short-lived token
    console.log("[instagram-exchange] Exchanging code for token...");
    const tokenRes = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${appId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&client_secret=${appSecret}` +
      `&code=${code}`
    );
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("[instagram-exchange] Token exchange failed:", tokenData);
      return new Response(JSON.stringify({ error: 'Falha ao trocar código por token', details: tokenData }), { status: 400, headers });
    }
    console.log("[instagram-exchange] Short-lived token obtained");

    // Step 2: Exchange for long-lived token
    const longRes = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `grant_type=fb_exchange_token` +
      `&client_id=${appId}` +
      `&client_secret=${appSecret}` +
      `&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longRes.json();
    const longLivedToken = longData.access_token || tokenData.access_token;
    const expiresIn = longData.expires_in || 5184000; // default 60 days
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    console.log("[instagram-exchange] Long-lived token obtained, expires in", expiresIn, "seconds");

    // Step 3: Fetch pages
    console.log("[instagram-exchange] Fetching pages...");
    const pagesRes = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token&access_token=${longLivedToken}`
    );
    const pagesData = await pagesRes.json();

    if (!pagesData.data || pagesData.data.length === 0) {
      console.error("[instagram-exchange] No pages found:", pagesData);
      return new Response(JSON.stringify({ error: 'Nenhuma página do Facebook encontrada. Verifique se sua conta tem páginas.' }), { status: 400, headers });
    }
    console.log("[instagram-exchange] Found", pagesData.data.length, "pages");

    // Step 4: Find Instagram Business Account on each page
    let selectedPage: any = null;
    let igAccount: any = null;

    for (const page of pagesData.data) {
      const igRes = await fetch(
        `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account{id,username,profile_picture_url}&access_token=${page.access_token}`
      );
      const igData = await igRes.json();

      if (igData.instagram_business_account) {
        selectedPage = page;
        igAccount = igData.instagram_business_account;
        console.log("[instagram-exchange] Found IG account:", igAccount.username, "on page:", page.name);
        break;
      }
    }

    if (!selectedPage || !igAccount) {
      console.error("[instagram-exchange] No Instagram Business Account linked to any page");
      return new Response(JSON.stringify({ error: 'Nenhuma conta Instagram Business vinculada às suas páginas do Facebook' }), { status: 400, headers });
    }

    // Step 5: Persist connection
    console.log("[instagram-exchange] Saving connection...");

    // Upsert social_integrations
    await supabaseAdmin.from('social_integrations').upsert({
      organization_id: organizationId,
      platform: 'instagram',
      page_id: selectedPage.id,
      page_name: selectedPage.name,
      access_token: selectedPage.access_token,
      status: 'active',
    }, { onConflict: 'organization_id,platform,page_id' });

    // Upsert instagram_connections
    const { data: connection, error: saveError } = await supabaseAdmin
      .from('instagram_connections')
      .upsert({
        organization_id: organizationId,
        instagram_business_account_id: igAccount.id,
        page_id: selectedPage.id,
        page_name: selectedPage.name,
        page_access_token: selectedPage.access_token,
        instagram_username: igAccount.username || null,
        profile_picture_url: igAccount.profile_picture_url || null,
        is_active: true,
        connected_by: userId,
      }, {
        onConflict: 'organization_id,instagram_business_account_id',
      })
      .select()
      .single();

    if (saveError) {
      console.error("[instagram-exchange] Save error:", saveError);
      return new Response(JSON.stringify({ error: 'Falha ao salvar conexão', details: saveError.message }), { status: 500, headers });
    }

    // Grant permissions to connecting user
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

    console.log("[instagram-exchange] Connection saved successfully:", connection.id);

    return new Response(JSON.stringify({
      ok: true,
      connection: {
        id: connection.id,
        instagram_username: igAccount.username,
        page_name: selectedPage.name,
        profile_picture_url: igAccount.profile_picture_url,
        is_active: true,
      },
    }), { status: 200, headers });

  } catch (error) {
    console.error('[instagram-exchange] Unhandled error:', error);
    return new Response(JSON.stringify({ error: 'Erro interno', details: String(error) }), { status: 500, headers });
  }
});
