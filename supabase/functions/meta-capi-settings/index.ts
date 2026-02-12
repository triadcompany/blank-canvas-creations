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

/** Ensure the organization exists in saas_organizations (auto-heal). */
async function ensureOrg(
  supabase: any,
  organizationId: string,
  profileId: string,
  prefix: string
): Promise<{ ok: boolean; error?: string }> {
  // Check saas_organizations first
  const { data: saasOrg } = await supabase
    .from("saas_organizations")
    .select("id")
    .eq("id", organizationId)
    .maybeSingle();

  if (saasOrg) return { ok: true };

  console.log(`${prefix} saas_organizations row missing for ${organizationId}, auto-healing...`);

  // Fetch profile info to populate owner fields
  const { data: prof } = await supabase
    .from("profiles")
    .select("id, name, email, clerk_user_id")
    .eq("id", profileId)
    .maybeSingle();

  const ownerName = prof?.name || "Admin";
  const ownerEmail = prof?.email || null;
  const slug = `org-${organizationId.substring(0, 8)}`;

  const { error: insertErr } = await supabase.from("saas_organizations").insert({
    id: organizationId,
    owner_id: profileId,
    name: `Org ${organizationId.substring(0, 8)}`,
    slug,
    owner_name: ownerName,
    owner_email: ownerEmail,
  });

  if (insertErr) {
    // Could be a race condition / duplicate – check again
    const { data: recheck } = await supabase
      .from("saas_organizations")
      .select("id")
      .eq("id", organizationId)
      .maybeSingle();
    if (recheck) return { ok: true };

    console.error(`${prefix} Failed to auto-heal saas_organizations:`, insertErr);
    return { ok: false, error: insertErr.message };
  }

  console.log(`${prefix} Auto-healed saas_organizations for ${organizationId}`);
  return { ok: true };
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
      action: "save" | "test" | "status" | "queue_logs";
      profile_id?: string;
      organization_id?: string;
      payload?: Record<string, unknown>;
    };

    const prefix =
      action === "save"
        ? "[META_CAPI_SETTINGS_SAVE]"
        : action === "test"
        ? "[META_CAPI_TEST]"
        : action === "queue_logs"
        ? "[META_CAPI_QUEUE_LOGS]"
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

    // ── Verify profile belongs to org ──
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, organization_id, clerk_user_id, name, email")
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

    // Check admin role (lenient for Clerk-only setups)
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", profile.clerk_user_id)
      .limit(1)
      .maybeSingle();

    let isAdmin = roleRow?.role === "admin";
    if (!isAdmin) {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("role")
        .eq("organization_id", organization_id)
        .limit(10);
      if (roleRows && roleRows.length > 0) {
        isAdmin = roleRows.some((r: any) => r.role === "admin");
      } else {
        isAdmin = true; // No roles table entries – Clerk-only, allow
      }
    }

    console.log(`${prefix} is_admin=${isAdmin}`);

    // ── Auto-heal: ensure org exists in saas_organizations ──
    const healResult = await ensureOrg(supabase, organization_id, profile_id, prefix);
    if (!healResult.ok) {
      return json({
        ok: false,
        code: "ORG_HEAL_FAILED",
        message: `Não foi possível criar/verificar a organização: ${healResult.error}`,
      }, 500);
    }

    // ═══════ QUEUE LOGS (Admin) ═══════
    if (action === "queue_logs") {
      if (!isAdmin) {
        return json({ ok: false, code: "NOT_ADMIN", message: "Apenas administradores podem ver os logs" }, 403);
      }

      const status = (payload?.status as string) || "all";
      const eventName = (payload?.event_name as string) || "all";
      const period = (payload?.period as string) || "7d";

      let q = supabase
        .from("event_dispatch_queue")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("channel", "meta_capi")
        .order("created_at", { ascending: false })
        .limit(50);

      if (status !== "all") q = q.eq("status", status);
      if (eventName !== "all") q = q.eq("event_name", eventName);

      const now = new Date();
      if (period === "7d") {
        q = q.gte("created_at", new Date(now.getTime() - 7 * 86400000).toISOString());
      } else if (period === "30d") {
        q = q.gte("created_at", new Date(now.getTime() - 30 * 86400000).toISOString());
      }

      const { data: items, error: qErr } = await q;
      if (qErr) {
        console.error(`${prefix} queue read error:`, qErr);
        return json({ ok: false, code: "DB_ERROR", message: qErr.message }, 500);
      }

      return json({ ok: true, items: items || [] });
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
          org_exists: true, // ensureOrg guarantees this
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
          code: "NOT_SAVED",
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

      // Send a real test event to Meta Graph API
      try {
        const eventTime = Math.floor(Date.now() / 1000);
        const testPayload: any = {
          data: [
            {
              event_name: "Lead",
              event_time: eventTime,
              action_source: "system_generated",
              user_data: { client_ip_address: "0.0.0.0" },
            },
          ],
        };

        if (settings.test_mode && settings.test_event_code) {
          testPayload.test_event_code = settings.test_event_code;
        }

        const metaRes = await fetch(
          `https://graph.facebook.com/v19.0/${settings.pixel_id}/events?access_token=${settings.access_token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(testPayload),
          }
        );

        const metaData = await metaRes.json();

        if (!metaRes.ok) {
          const metaErr = metaData.error || {};
          let code = "META_UNKNOWN";
          let message = metaErr.message || "Erro desconhecido da Meta";

          if (metaErr.code === 190) {
            code = "INVALID_TOKEN";
            message = "Access Token inválido ou expirado. Gere um novo token no Business Manager.";
          } else if (metaErr.code === 100 || (metaErr.message || "").toLowerCase().includes("permission")) {
            code = "MISSING_PERMISSION";
            message =
              "Seu token não tem permissão para enviar eventos para este Pixel/Dataset. " +
              "Use um System User no Business Manager com acesso ao Dataset + permissões de evento.";
          } else if (metaErr.type === "OAuthException" && metaErr.code === 803) {
            code = "INVALID_DATASET";
            message = "Dataset/Pixel ID não encontrado. Verifique o ID no Events Manager.";
          }

          console.error(`${prefix} Meta API error:`, { code, metaErr });
          return json({ ok: false, code, message, meta_error: metaErr }, 400);
        }

        console.log(`${prefix} Test event sent OK!`, metaData);
        return json({
          ok: true,
          message: `Evento de teste enviado com sucesso! Events received: ${metaData.events_received ?? "?"}`,
          meta_response: metaData,
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
