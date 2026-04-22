import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const CLERK_SECRET_KEY = Deno.env.get("CLERK_SECRET_KEY");

async function updateClerkOrgMembership(
  clerkOrgId: string,
  clerkUserId: string,
  role: "admin" | "seller",
): Promise<{ ok: boolean; error?: string }> {
  if (!CLERK_SECRET_KEY) {
    console.warn("⚠️ CLERK_SECRET_KEY missing — skipping Clerk update");
    return { ok: true };
  }
  const clerkRole = role === "admin" ? "org:admin" : "org:member";
  try {
    const res = await fetch(
      `https://api.clerk.com/v1/organizations/${clerkOrgId}/memberships/${clerkUserId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${CLERK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: clerkRole }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      console.error("❌ Clerk membership update failed:", res.status, text);
      return { ok: false, error: `Clerk: ${res.status} ${text}` };
    }
    return { ok: true };
  } catch (err: any) {
    console.error("❌ Clerk API error:", err);
    return { ok: false, error: err?.message ?? "Clerk API error" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      callerClerkUserId,
      targetClerkUserId,
      organizationId,
      newRole,
    } = await req.json();

    if (!callerClerkUserId || !targetClerkUserId || !organizationId || !newRole) {
      return new Response(
        JSON.stringify({ error: "Parâmetros obrigatórios ausentes" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    if (!["admin", "seller"].includes(newRole)) {
      return new Response(
        JSON.stringify({ error: "Papel inválido" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    console.log("🔄 Atualizando papel:", { targetClerkUserId, organizationId, newRole });

    // 1) Atualizar no Supabase via RPC (valida admin + atualiza tabelas)
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "update_user_role_rpc",
      {
        p_caller_clerk_user_id: callerClerkUserId,
        p_target_clerk_user_id: targetClerkUserId,
        p_organization_id: organizationId,
        p_new_role: newRole,
      },
    );

    if (rpcError) {
      console.error("❌ RPC error:", rpcError);
      return new Response(
        JSON.stringify({ error: rpcError.message ?? "Erro ao atualizar papel" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const clerkOrgId = (rpcData as any)?.clerk_org_id as string | undefined;

    // 2) Sincronizar com Clerk (best-effort — se falhar, reportar mas não revogar)
    let clerkWarning: string | undefined;
    if (clerkOrgId) {
      const clerkResult = await updateClerkOrgMembership(
        clerkOrgId,
        targetClerkUserId,
        newRole,
      );
      if (!clerkResult.ok) {
        clerkWarning = clerkResult.error;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: rpcData,
        clerkWarning,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (err: any) {
    console.error("❌ update-user-role error:", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Erro inesperado" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});
