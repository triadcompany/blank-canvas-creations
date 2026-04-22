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
    console.log("[instagram-exchange] === START ===", { profileId, organizationId, hasCode: !!code, hasState: !!state });

    if (!code || !organizationId || !profileId) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios: code, organizationId, profileId' }), { status: 400, headers });
    }

    // Validate profile (resolve identity only — membership is validated via org_members below).
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, clerk_user_id')
      .eq('id', profileId)
      .single();

    if (profileError || !profile) {
      console.error("[instagram-exchange] Profile not found:", profileId);
      return new Response(JSON.stringify({ error: 'Perfil não encontrado' }), { status: 401, headers });
    }

    // Validate org membership against org_members (multi-org safe).
    const clerkUserId = profile.clerk_user_id || req.headers.get('x-clerk-user-id');
    if (!clerkUserId) {
      console.error("[instagram-exchange] No clerk_user_id available for membership check");
      return new Response(JSON.stringify({ error: 'Identidade Clerk não encontrada' }), { status: 401, headers });
    }
    const { data: membership } = await supabaseAdmin
      .from('org_members')
      .select('organization_id')
      .eq('clerk_user_id', clerkUserId)
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .maybeSingle();
    if (!membership) {
      console.error("[instagram-exchange] User not member of requested org", { clerkUserId, organizationId });
      return new Response(JSON.stringify({ error: 'Usuário não pertence à organização' }), { status: 403, headers });
    }

    const userId = profile.user_id || profile.id;
    const redirectUri = 'https://autolead.lovable.app/settings?tab=instagram&callback=true';

    // ============================================================
    // STEP A: Exchange code for token (USER token, NOT app token)
    // ============================================================
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${appId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&client_secret=${appSecret}` +
      `&code=${code}`;

    console.log("[instagram-exchange] [A] Token exchange — redirect_uri used:", redirectUri);
    console.log("[instagram-exchange] [A] Token exchange — client_id:", appId);

    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    console.log("[instagram-exchange] [A] Token exchange — HTTP status:", tokenRes.status);
    console.log("[instagram-exchange] [A] Token exchange — response body:", JSON.stringify({
      ...tokenData,
      access_token: tokenData.access_token ? `${tokenData.access_token.substring(0, 15)}...REDACTED` : undefined,
    }));

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("[instagram-exchange] [A] Token exchange FAILED — full response:", JSON.stringify(tokenData));
      return new Response(JSON.stringify({
        error: 'TOKEN_EXCHANGE_FAILED',
        message: 'Falha ao trocar código por token',
        meta_response: tokenData,
      }), { status: 400, headers });
    }

    // Exchange for long-lived token (still USER token)
    const longRes = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `grant_type=fb_exchange_token` +
      `&client_id=${appId}` +
      `&client_secret=${appSecret}` +
      `&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longRes.json();
    const userToken = longData.access_token || tokenData.access_token;
    const expiresIn = longData.expires_in || 5184000;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    console.log("[instagram-exchange] [A] Long-lived token — HTTP status:", longRes.status, "expires_in:", expiresIn);

    // ============================================================
    // STEP B: Validate user identity (/me)
    // ============================================================
    const meRes = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${userToken}`);
    const meData = await meRes.json();
    console.log("[instagram-exchange] [B] /me — HTTP status:", meRes.status, "body:", JSON.stringify(meData));

    if (!meRes.ok) {
      console.error("[instagram-exchange] [B] /me FAILED");
      return new Response(JSON.stringify({
        error: 'ME_FETCH_FAILED',
        message: 'Falha ao validar identidade do usuário com o token',
        meta_response: meData,
      }), { status: 400, headers });
    }

    // ============================================================
    // STEP B2: Debug token — check granted scopes
    // ============================================================
    let debugData: any = {};
    try {
      const debugRes = await fetch(
        `https://graph.facebook.com/v18.0/debug_token?input_token=${userToken}&access_token=${appId}|${appSecret}`
      );
      debugData = await debugRes.json();
      console.log("[instagram-exchange] [B2] debug_token — HTTP status:", debugRes.status);
      console.log("[instagram-exchange] [B2] debug_token — type:", debugData.data?.type);
      console.log("[instagram-exchange] [B2] debug_token — is_valid:", debugData.data?.is_valid);
      console.log("[instagram-exchange] [B2] debug_token — scopes:", JSON.stringify(debugData.data?.scopes));
      console.log("[instagram-exchange] [B2] debug_token — granular_scopes:", JSON.stringify(debugData.data?.granular_scopes));
    } catch (e) {
      console.error("[instagram-exchange] [B2] debug_token fetch error:", e);
    }

    // ============================================================
    // STEP C: Fetch pages (/me/accounts)
    // ============================================================
    const pagesRes = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,perms&limit=200&access_token=${userToken}`
    );
    const pagesData = await pagesRes.json();
    console.log("[instagram-exchange] [C] /me/accounts — HTTP status:", pagesRes.status);
    console.log("[instagram-exchange] [C] /me/accounts — pages count:", pagesData.data?.length ?? 0);
    console.log("[instagram-exchange] [C] /me/accounts — full body:", JSON.stringify(pagesData));

    if (!pagesData.data || pagesData.data.length === 0) {
      console.error("[instagram-exchange] [C] NO PAGES FOUND for user:", meData.name, "(", meData.id, ")");
      return new Response(JSON.stringify({
        error: 'NO_FACEBOOK_PAGES',
        message: 'Nenhuma Página do Facebook encontrada para este usuário/token.',
        me: meData,
        debug: debugData.data || null,
        accounts: pagesData,
        hint: 'Seu token não recebeu pages_show_list ou o app não tem Advanced Access/Ready for testing para permissões de Páginas em App Review > Permissions and Features.',
      }), { status: 400, headers });
    }

    // Step 4: Find Instagram Business Account on each page
    let selectedPage: any = null;
    let igAccount: any = null;

    for (const page of pagesData.data) {
      console.log("[instagram-exchange] Checking page:", page.name, "(", page.id, ") perms:", JSON.stringify(page.perms));
      const igRes = await fetch(
        `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account{id,username,profile_picture_url}&access_token=${page.access_token}`
      );
      const igData = await igRes.json();
      console.log("[instagram-exchange] Page", page.id, "IG data:", JSON.stringify(igData));

      if (igData.instagram_business_account) {
        selectedPage = page;
        igAccount = igData.instagram_business_account;
        console.log("[instagram-exchange] ✅ Found IG account:", igAccount.username, "on page:", page.name);
        break;
      }
    }

    if (!selectedPage || !igAccount) {
      console.error("[instagram-exchange] No IG Business Account found. Pages checked:", pagesData.data.length);
      return new Response(JSON.stringify({
        error: 'NO_IG_BUSINESS',
        message: 'Nenhuma conta Instagram Business vinculada às suas Páginas. Converta seu Instagram para conta profissional e vincule a uma Página.',
        me: meData,
        pages_checked: pagesData.data.map((p: any) => ({ id: p.id, name: p.name })),
      }), { status: 400, headers });
    }

    // Step 5: Persist connection
    console.log("[instagram-exchange] Saving connection...");

    await supabaseAdmin.from('social_integrations').upsert({
      organization_id: organizationId,
      platform: 'instagram',
      page_id: selectedPage.id,
      page_name: selectedPage.name,
      access_token: selectedPage.access_token,
      status: 'active',
    }, { onConflict: 'organization_id,platform,page_id' });

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

    console.log("[instagram-exchange] === SUCCESS === connection:", connection.id, "IG:", igAccount.username);

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
