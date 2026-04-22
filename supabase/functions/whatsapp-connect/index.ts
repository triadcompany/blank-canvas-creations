// whatsapp-connect: cria instância na Evolution e retorna QR code
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-clerk-user-id, x-clerk-org-id, x-organization-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function extractQr(data: any): string | null {
  const candidates = [
    data?.qrcode?.base64,
    data?.base64,
    data?.qrcode?.code,
    data?.qrcode,
    data?.instance?.qrcode?.base64,
    data?.code,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 10) return c;
  }
  return null;
}

function slugifyOrgName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")     // não-alfanumérico → hífen
    .replace(/^-+|-+$/g, "")          // remove hífens nas pontas
    .replace(/-+/g, "-");             // colapsa hífens duplicados
}

function buildInstanceName(orgName: string | null, organizationId: string): string {
  const shortTs = String(Date.now()).slice(-8); // últimos 8 dígitos
  const baseSlug = orgName ? slugifyOrgName(orgName) : "";
  const slug = baseSlug || `org-${organizationId.slice(0, 8)}`;
  // Limita a 50 chars total: slug + "_" + 8 dígitos = máx 50
  const maxSlugLen = 50 - 1 - shortTs.length; // 41
  const trimmedSlug = slug.slice(0, maxSlugLen).replace(/-+$/g, "");
  return `${trimmedSlug}_${shortTs}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evoUrl = Deno.env.get("EVOLUTION_BASE_URL");
    const evoKey = Deno.env.get("EVOLUTION_API_KEY");

    if (!evoUrl || !evoKey) {
      return respond({ ok: false, error: "EVOLUTION_BASE_URL/EVOLUTION_API_KEY não configurados" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const clerkUserId = req.headers.get("x-clerk-user-id");
    const { organization_id } = await req.json();

    if (!organization_id) return respond({ ok: false, error: "organization_id obrigatório" }, 400);
    if (!clerkUserId) return respond({ ok: false, error: "x-clerk-user-id header ausente" }, 401);

    // Validar admin da org + buscar nome da org para gerar instance_name legível
    const [{ data: profile }, { data: org }] = await Promise.all([
      supabase
        .from("profiles")
        .select("organization_id")
        .eq("clerk_user_id", clerkUserId)
        .eq("organization_id", organization_id)
        .maybeSingle(),
      supabase
        .from("organizations")
        .select("name")
        .eq("id", organization_id)
        .maybeSingle(),
    ]);

    if (!profile) return respond({ ok: false, error: "Usuário não pertence à organização" }, 403);

    // Busca QUALQUER registro existente (connected/connecting/disconnected/error)
    // e valida live na Evolution antes de decidir bloquear ou limpar.
    const { data: existingRows } = await supabase
      .from("whatsapp_connections")
      .select("id, status, instance_name")
      .eq("organization_id", organization_id);

    for (const existing of existingRows || []) {
      let aliveOnEvolution = false;
      let stateOnEvolution: string | null = null;

      // Verifica live na Evolution
      try {
        const stateRes = await fetch(
          `${evoUrl}/instance/connectionState/${existing.instance_name}`,
          { method: "GET", headers: { apikey: evoKey } },
        );
        if (stateRes.ok) {
          const stateData = await stateRes.json();
          stateOnEvolution = stateData?.instance?.state || stateData?.state || null;
          aliveOnEvolution = stateOnEvolution === "open";
        } else if (stateRes.status === 404) {
          aliveOnEvolution = false;
        }
      } catch (e) {
        console.error(`[whatsapp-connect] connectionState check failed for ${existing.instance_name}:`, e);
      }

      console.log(
        `[whatsapp-connect] Existing instance ${existing.instance_name}: db_status=${existing.status} live_state=${stateOnEvolution} alive=${aliveOnEvolution}`,
      );

      // Se está realmente conectado na Evolution, bloqueia
      if (aliveOnEvolution) {
        // Sincroniza status no banco caso esteja divergente
        if (existing.status !== "connected") {
          await supabase
            .from("whatsapp_connections")
            .update({ status: "connected", last_connected_at: new Date().toISOString() })
            .eq("id", existing.id);
        }
        return respond(
          { ok: false, error: "Já existe WhatsApp conectado para esta organização" },
          409,
        );
      }

      // Não está vivo — tenta deletar instância órfã na Evolution e remove do banco
      try {
        await fetch(`${evoUrl}/instance/delete/${existing.instance_name}`, {
          method: "DELETE",
          headers: { apikey: evoKey },
        });
      } catch (_) { /* ignore */ }
      await supabase.from("whatsapp_connections").delete().eq("id", existing.id);
      console.log(`[whatsapp-connect] Cleaned orphan record ${existing.id} (${existing.instance_name})`);
    }

    // Gerar instance_name único
    const instanceName = `autolead_${organization_id.replace(/-/g, "")}_${Date.now()}`;
    const webhookUrl = `${supabaseUrl}/functions/v1/whatsapp-webhook-v2`;

    console.log(`[whatsapp-connect] Creating instance: ${instanceName}`);

    const createRes = await fetch(`${evoUrl}/instance/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: evoKey },
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
        webhook: {
          url: webhookUrl,
          byEvents: false,
          base64: true,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        },
      }),
    });

    const createText = await createRes.text();
    console.log(`[whatsapp-connect] Evolution response: ${createRes.status} | ${createText.substring(0, 400)}`);

    if (!createRes.ok) {
      return respond({ ok: false, error: `Evolution API erro ${createRes.status}: ${createText.substring(0, 300)}` }, 500);
    }

    const createData = JSON.parse(createText);
    const instanceApiKey = createData?.hash?.apikey || createData?.hash || null;
    let qrCode = extractQr(createData);

    // Se QR não veio na criação, faz GET /instance/connect
    if (!qrCode) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const r = await fetch(`${evoUrl}/instance/connect/${instanceName}`, {
          method: "GET",
          headers: { apikey: evoKey },
        });
        const t = await r.text();
        if (r.ok) {
          const d = JSON.parse(t);
          qrCode = extractQr(d);
        }
      } catch (e) {
        console.error("[whatsapp-connect] connect call failed:", e);
      }
    }

    // Salvar no banco
    const { data: inserted, error: insertErr } = await supabase
      .from("whatsapp_connections")
      .insert({
        organization_id,
        instance_name: instanceName,
        status: "connecting",
        qr_code: qrCode,
        evolution_api_key: instanceApiKey,
        created_by_clerk_user_id: clerkUserId,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("[whatsapp-connect] Insert failed:", insertErr);
      // tenta limpar instância órfã
      await fetch(`${evoUrl}/instance/delete/${instanceName}`, {
        method: "DELETE",
        headers: { apikey: evoKey },
      }).catch(() => {});
      return respond({ ok: false, error: insertErr.message }, 500);
    }

    return respond({
      ok: true,
      connection: inserted,
      qr_code: qrCode,
      instance_name: instanceName,
    });
  } catch (err) {
    console.error("[whatsapp-connect] Unhandled:", err);
    return respond({ ok: false, error: String(err) }, 500);
  }
});
