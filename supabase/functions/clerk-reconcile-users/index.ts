// Reconcile Supabase profiles with Clerk users.
// - mode=preview (default): returns lists of orphans (in Supabase but not in Clerk)
// - mode=apply: deletes the provided clerk_user_ids via purge_user_cascade RPC
//
// Auth: requires the caller to be an authenticated admin via x-clerk-user-id header.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-clerk-user-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLERK_SECRET_KEY = Deno.env.get("CLERK_SECRET_KEY");

interface ClerkUser {
  id: string;
  email_addresses?: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

async function fetchAllClerkUsers(): Promise<ClerkUser[]> {
  if (!CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY is not configured");
  }
  const all: ClerkUser[] = [];
  let offset = 0;
  const limit = 100;
  // Hard cap to avoid runaway loops on huge tenants.
  const maxIterations = 100;

  for (let i = 0; i < maxIterations; i++) {
    const url = `https://api.clerk.com/v1/users?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Clerk API ${res.status}: ${txt.slice(0, 200)}`);
    }
    const batch = (await res.json()) as ClerkUser[];
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // ---- Authenticate admin caller via x-clerk-user-id header ----
    const callerClerkId = req.headers.get("x-clerk-user-id");
    if (!callerClerkId) {
      return new Response(JSON.stringify({ error: "Missing x-clerk-user-id" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerRoles, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("clerk_user_id", callerClerkId);

    if (roleErr) {
      console.error("role lookup failed", roleErr);
      return new Response(JSON.stringify({ error: "Role lookup failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isAdmin = (callerRoles ?? []).some((r: any) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const mode: "preview" | "apply" = body?.mode === "apply" ? "apply" : "preview";

    // ---------------- PREVIEW MODE ----------------
    if (mode === "preview") {
      console.log("🔄 reconcile preview started");

      const [clerkUsers, profilesRes, usersProfileRes] = await Promise.all([
        fetchAllClerkUsers(),
        supabase
          .from("profiles")
          .select("id, clerk_user_id, name, email, organization_id, created_at"),
        supabase
          .from("users_profile")
          .select("id, clerk_user_id, full_name, email"),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (usersProfileRes.error) throw usersProfileRes.error;

      const clerkIdSet = new Set(clerkUsers.map((u) => u.id));
      const profiles = profilesRes.data ?? [];
      const usersProfile = usersProfileRes.data ?? [];

      // Profiles in Supabase but no longer in Clerk
      const orphanProfiles = profiles.filter(
        (p) => p.clerk_user_id && !clerkIdSet.has(p.clerk_user_id),
      );
      const orphanUsersProfile = usersProfile.filter(
        (p) => p.clerk_user_id && !clerkIdSet.has(p.clerk_user_id),
      );

      // Clerk users not yet mirrored in users_profile
      const mirroredIds = new Set(usersProfile.map((p) => p.clerk_user_id));
      const missingMirror = clerkUsers
        .filter((u) => !mirroredIds.has(u.id))
        .map((u) => ({
          clerk_user_id: u.id,
          email:
            u.email_addresses?.find((e) => e.id === u.primary_email_address_id)
              ?.email_address ??
            u.email_addresses?.[0]?.email_address ??
            null,
          full_name: [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
        }));

      console.log(
        `clerk_users=${clerkUsers.length} profiles=${profiles.length} users_profile=${usersProfile.length} orphans_profile=${orphanProfiles.length} orphans_mirror=${orphanUsersProfile.length} missing_mirror=${missingMirror.length}`,
      );

      return new Response(
        JSON.stringify({
          ok: true,
          mode,
          totals: {
            clerk_users: clerkUsers.length,
            profiles: profiles.length,
            users_profile: usersProfile.length,
          },
          orphan_profiles: orphanProfiles,
          orphan_users_profile: orphanUsersProfile,
          missing_mirror: missingMirror,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---------------- APPLY MODE ----------------
    const idsToPurge: string[] = Array.isArray(body?.clerk_user_ids)
      ? body.clerk_user_ids.filter((s: unknown) => typeof s === "string")
      : [];

    if (idsToPurge.length === 0) {
      return new Response(
        JSON.stringify({ error: "clerk_user_ids array is required for apply mode" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Safety: re-validate every id is actually orphaned in Clerk before purging.
    const clerkUsers = await fetchAllClerkUsers();
    const clerkIdSet = new Set(clerkUsers.map((u) => u.id));
    const trulyOrphan = idsToPurge.filter((id) => !clerkIdSet.has(id));
    const skipped = idsToPurge.filter((id) => clerkIdSet.has(id));

    console.log(
      `apply purge: requested=${idsToPurge.length} truly_orphan=${trulyOrphan.length} skipped=${skipped.length}`,
    );

    const results: Array<{ clerk_user_id: string; ok: boolean; detail?: any }> = [];
    for (const cid of trulyOrphan) {
      const { data, error } = await supabase.rpc("purge_user_cascade", {
        p_clerk_user_id: cid,
      });
      if (error) {
        console.error(`purge_user_cascade failed for ${cid}:`, error.message);
        results.push({ clerk_user_id: cid, ok: false, detail: error.message });
      } else {
        results.push({ clerk_user_id: cid, ok: true, detail: data });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        mode,
        purged: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        skipped_still_in_clerk: skipped,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("💥 reconcile error:", err?.message || err);
    return new Response(
      JSON.stringify({ error: err?.message || "Unexpected error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
