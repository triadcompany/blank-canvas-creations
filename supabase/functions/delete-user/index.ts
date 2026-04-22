// delete-user: REMOVE o usuário da organização atual.
// NÃO deleta a conta Clerk nem o profile global — apenas revoga o vínculo
// com a organização, para que ele saia de "Gerenciar Usuários".
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-clerk-user-id, x-clerk-org-id, x-organization-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const CLERK_SECRET_KEY = Deno.env.get("CLERK_SECRET_KEY");

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

// Remove o usuário da organização no Clerk (não deleta a conta).
async function removeFromClerkOrg(clerkOrgId: string, clerkUserId: string) {
  if (!CLERK_SECRET_KEY) {
    console.log("⚠️ CLERK_SECRET_KEY não configurado — pulando Clerk");
    return { ok: true, skipped: true };
  }
  try {
    const r = await fetch(
      `https://api.clerk.com/v1/organizations/${clerkOrgId}/memberships/${clerkUserId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${CLERK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (r.ok || r.status === 404) {
      console.log("✅ Membership removido do Clerk (ou inexistente)");
      return { ok: true };
    }
    const t = await r.text();
    console.error("❌ Falha ao remover membership do Clerk:", r.status, t);
    return { ok: false, error: `Clerk ${r.status}: ${t.slice(0, 200)}` };
  } catch (e) {
    console.error("❌ Erro chamando Clerk:", e);
    return { ok: false, error: String(e) };
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requesterClerkUserId = req.headers.get("x-clerk-user-id");
    const orgIdHeader = req.headers.get("x-organization-id");
    const body = await req.json().catch(() => ({}));
    const { profileId, clerkUserId, organizationId } = body as {
      profileId?: string;
      clerkUserId?: string;
      organizationId?: string;
    };

    if (!profileId) return json({ error: "profileId é obrigatório" }, 400);
    if (!requesterClerkUserId) {
      return json({ error: "x-clerk-user-id ausente" }, 401);
    }

    // Resolver org alvo: header > body > org do solicitante
    let targetOrgId = organizationId || orgIdHeader || null;
    if (!targetOrgId) {
      const { data: requester } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("clerk_user_id", requesterClerkUserId)
        .maybeSingle();
      targetOrgId = requester?.organization_id ?? null;
    }
    if (!targetOrgId) return json({ error: "organization_id não encontrado" }, 400);

    // Validar que solicitante é admin da org alvo
    const { data: requesterRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("clerk_user_id", requesterClerkUserId)
      .eq("organization_id", targetOrgId)
      .maybeSingle();

    if (!requesterRole || requesterRole.role !== "admin") {
      return json({ error: "Apenas administradores podem remover usuários" }, 403);
    }

    // Buscar perfil alvo (precisa ser da mesma org)
    const { data: target, error: targetErr } = await supabase
      .from("profiles")
      .select("id, clerk_user_id, organization_id")
      .eq("id", profileId)
      .maybeSingle();

    if (targetErr || !target) return json({ error: "Perfil não encontrado" }, 404);
    if (target.organization_id !== targetOrgId) {
      return json({ error: "Perfil não pertence à organização atual" }, 403);
    }

    const targetClerkId = target.clerk_user_id || clerkUserId;
    if (targetClerkId === requesterClerkUserId) {
      return json({ error: "Você não pode remover a si mesmo" }, 400);
    }

    console.log("👋 Removendo usuário da organização:", {
      profileId,
      targetClerkId,
      targetOrgId,
    });

    // 1) Roles desta org
    if (targetClerkId) {
      const { error: rolesErr } = await supabase
        .from("user_roles")
        .delete()
        .eq("clerk_user_id", targetClerkId)
        .eq("organization_id", targetOrgId);
      if (rolesErr) console.warn("⚠️ user_roles:", rolesErr.message);
    }

    // 2) Vínculo em org_members (se existir tabela)
    if (targetClerkId) {
      const { error: omErr } = await supabase
        .from("org_members")
        .delete()
        .eq("clerk_user_id", targetClerkId)
        .eq("organization_id", targetOrgId);
      if (omErr) console.warn("⚠️ org_members:", omErr.message);
    }

    // 3) Profile da org (deleta apenas o registro de profile vinculado a essa org).
    // NÃO removemos users_profile (espelho global do Clerk) nem deletamos a conta.
    const { error: profErr } = await supabase
      .from("profiles")
      .delete()
      .eq("id", profileId);
    if (profErr) {
      console.error("❌ profiles:", profErr);
      return json({ error: "Erro ao remover perfil", details: profErr.message }, 500);
    }

    // 4) Remover membership no Clerk (não deleta a conta do usuário)
    let clerkResult: any = { skipped: true };
    if (targetClerkId) {
      // Resolver clerk_org_id a partir da org interna
      const { data: clerkOrg } = await supabase
        .from("clerk_organizations")
        .select("clerk_org_id")
        .eq("id", targetOrgId)
        .maybeSingle();
      if (clerkOrg?.clerk_org_id) {
        clerkResult = await removeFromClerkOrg(clerkOrg.clerk_org_id, targetClerkId);
      } else {
        console.warn("⚠️ clerk_org_id não encontrado para org", targetOrgId);
      }
    }

    return json({
      success: true,
      message: "Usuário removido da organização",
      clerk: clerkResult,
    });
  } catch (err: any) {
    console.error("❌ delete-user erro:", err);
    return json({ error: "Erro interno", details: err?.message ?? String(err) }, 500);
  }
});
