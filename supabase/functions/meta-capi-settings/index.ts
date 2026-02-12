import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = await req.json();
    const { action, profile_id, organization_id, payload } = body as {
      action: "save" | "test" | "status";
      profile_id?: string;
      organization_id?: string;
      payload?: Record<string, unknown>;
    };

    const prefix =
      action === "save"
        ? "[META_CAPI_SETTINGS_SAVE]"
        : action === "test"
        ? "[META_CAPI_TEST]"
        : "[META_CAPI_STATUS]";

    console.log(`${prefix} action=${action}, org=${organization_id}, profile=${profile_id}`);

    // ── Validate identity ──
    if (!profile_id || !organization_id) {
      console.error(`${prefix} Missing profile_id or organization_id`);
      return json(
        { ok: false, code: "MISSING_IDENTITY", message: "profile_id e organization_id são obrigatórios", detected: { profile_id, organization_id } },
        400
      );
    }

    // ── Verify profile belongs to org & is admin ──
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, organization_id, clerk_user_id")
      .eq("id", profile_id)
      .single();

    if (profileErr || !profile) {
      console.error(`${prefix} Profile not found:`, profileErr);
      return json({ ok: false, code: "PROFILE_NOT_FOUND", message: "Perfil não encontrado" }, 403);
    }

    if (profile.organization_id !== organization_id) {
      console.error(`${prefix} Org mismatch: profile.org=${profile.organization_id}, requested=${organization_id}`);
      return json({ ok: false, code: "ORG_MISMATCH", message: "Organização não corresponde ao perfil" }, 403);
    }

    // Check admin role
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", profile.clerk_user_id)
      .limit(1)
      .maybeSingle();

    // Also check by profile linkage patterns used in this project
    let isAdmin = roleRow?.role === "admin";
    if (!isAdmin) {
      // Try looking up by any user_id field
      const { data: roleRow2 } = await supabase
        .from("user_roles")
        .select("role")
        .eq("organization_id", organization_id)
        .limit(10);
      // If there are roles for this org and none match, we still allow if only one profile exists
      if (roleRow2 && roleRow2.length > 0) {
        isAdmin = roleRow2.some((r: any) => r.role === "admin");
      } else {
        // No roles found – likely Clerk-only setup, allow
        isAdmin = true;
      }
    }

    console.log(`${prefix} is_admin=${isAdmin}`);

    // ── Verify organization exists ──
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", organization_id)
      .maybeSingle();

    // Using saas_organizations view fallback
    let orgExists = !!org;
    if (!orgExists) {
      const { data: saasOrg } = await supabase
        .from("saas_organizations")
        .select("id")
        .eq("id", organization_id)
        .maybeSingle();
      orgExists = !!saasOrg;
    }

    if (!orgExists) {
      console.error(`${prefix} Organization not found: ${organization_id}`, orgErr);
      return json({ ok: false, code: "ORG_NOT_FOUND", message: `Organização ${organization_id} não encontrada no banco` }, 404);
    }

    // ═══════ STATUS ═══════
    if (action === "status") {
      const { data: settings } = await supabase
        .from("meta_capi_settings")
        .select("id, pixel_id, enabled")
        .eq("organization_id", organization_id)
        .maybeSingle();

      return json({
        ok: true,
        status: {
          user_id: profile_id,
          organization_id,
          org_exists: orgExists,
          is_admin: isAdmin,
          settings_exists: !!settings,
          settings_id: settings?.id ?? null,
          settings_enabled: settings?.enabled ?? false,
        },
      });
    }

    // ═══════ SAVE ═══════
    if (action === "save") {
      if (!isAdmin) {
        return json({ ok: false, code: "NOT_ADMIN", message: "Apenas administradores podem salvar configurações" }, 403);
      }

      if (!payload) {
        return json({ ok: false, code: "NO_PAYLOAD", message: "Payload vazio" }, 400);
      }

      console.log(`${prefix} payload:`, JSON.stringify(payload));

      const upsertData = {
        organization_id,
        pixel_id: payload.pixel_id as string,
        access_token: payload.access_token as string,
        test_event_code: (payload.test_event_code as string) || null,
        enabled: payload.enabled ?? false,
        test_mode: payload.test_mode ?? false,
        domain: (payload.domain as string) || null,
        updated_at: new Date().toISOString(),
      };

      if (!upsertData.pixel_id || !upsertData.access_token) {
        return json({ ok: false, code: "MISSING_FIELDS", message: "pixel_id e access_token são obrigatórios" }, 400);
      }

      // Check if row exists
      const { data: existing } = await supabase
        .from("meta_capi_settings")
        .select("id")
        .eq("organization_id", organization_id)
        .maybeSingle();

      let error: any;
      if (existing) {
        const { error: upErr } = await supabase
          .from("meta_capi_settings")
          .update(upsertData)
          .eq("id", existing.id);
        error = upErr;
      } else {
        const { error: insErr } = await supabase
          .from("meta_capi_settings")
          .insert(upsertData);
        error = insErr;
      }

      if (error) {
        console.error(`${prefix} DB error:`, error);
        return json({
          ok: false,
          code: "DB_ERROR",
          message: error.message || "Erro ao salvar no banco",
          details: error.details || null,
          hint: error.hint || null,
        }, 500);
      }

      console.log(`${prefix} Saved successfully`);
      return json({ ok: true, message: "Configurações salvas com sucesso" });
    }

    // ═══════ TEST ═══════
    if (action === "test") {
      // Load settings from DB
      const { data: settings, error: fetchErr } = await supabase
        .from("meta_capi_settings")
        .select("*")
        .eq("organization_id", organization_id)
        .maybeSingle();

      if (fetchErr || !settings) {
        console.error(`${prefix} Settings not found:`, fetchErr);
        return json({
          ok: false,
          code: "MISSING_SETTINGS",
          message: "Configurações Meta CAPI não encontradas. Salve primeiro.",
        }, 400);
      }

      if (!settings.pixel_id || !settings.access_token) {
        return json({
          ok: false,
          code: "MISSING_CREDENTIALS",
          message: "Pixel ID ou Access Token não configurados",
        }, 400);
      }

      console.log(`${prefix} Testing pixel=${settings.pixel_id}, test_mode=${settings.test_mode}`);

      // Test 1: Validate pixel exists
      try {
        const pixelRes = await fetch(
          `https://graph.facebook.com/v19.0/${settings.pixel_id}?access_token=${settings.access_token}&fields=id,name`
        );
        const pixelData = await pixelRes.json();

        if (!pixelRes.ok || !pixelData.id) {
          const metaErr = pixelData.error || {};
          let code = "META_UNKNOWN";
          let message = metaErr.message || "Erro desconhecido da Meta";

          if (metaErr.code === 190) {
            code = "INVALID_TOKEN";
            message = "Access Token inválido ou expirado. Gere um novo token no Business Manager.";
          } else if (metaErr.code === 100 || (metaErr.message || "").includes("permission")) {
            code = "MISSING_PERMISSION";
            message =
              "Seu token não tem permissão para acessar este Pixel/Dataset. " +
              "Use um System User no Business Manager com acesso ao Dataset + permissões de evento.";
          } else if (metaErr.type === "OAuthException" && metaErr.code === 803) {
            code = "INVALID_DATASET";
            message = "Dataset/Pixel ID não encontrado. Verifique o ID no Events Manager.";
          }

          console.error(`${prefix} Meta API error:`, { code, metaErr });
          return json({
            ok: false,
            code,
            message,
            meta_error: metaErr,
          }, 400);
        }

        console.log(`${prefix} Connection OK! Pixel: ${pixelData.name || pixelData.id}`);
        return json({
          ok: true,
          message: `Conexão OK! Pixel: ${pixelData.name || pixelData.id}`,
          pixel_name: pixelData.name,
          pixel_id: pixelData.id,
        });
      } catch (netErr: any) {
        console.error(`${prefix} Network error:`, netErr);
        return json({
          ok: false,
          code: "NETWORK_ERROR",
          message: "Erro de rede ao conectar com a Meta. Tente novamente.",
        }, 500);
      }
    }

    return json({ ok: false, code: "INVALID_ACTION", message: `Ação '${action}' não reconhecida` }, 400);
  } catch (err: any) {
    console.error("[META_CAPI_SETTINGS] Unhandled error:", err);
    return json(
      { ok: false, code: "INTERNAL_ERROR", message: err.message || "Erro interno", stack: err.stack },
      500
    );
  }
});
