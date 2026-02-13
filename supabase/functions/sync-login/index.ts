import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const { clerk_user_id, email, full_name, avatar_url } = await req.json();

    if (!clerk_user_id) {
      return new Response(JSON.stringify({ error: "clerk_user_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`🔄 sync-login for user: ${clerk_user_id}`);

    // Upsert users_profile with last_login_at
    const { data, error } = await supabase
      .from("users_profile")
      .upsert(
        {
          clerk_user_id,
          email: email || null,
          full_name: full_name || null,
          avatar_url: avatar_url || null,
          last_login_at: new Date().toISOString(),
        },
        { onConflict: "clerk_user_id" }
      )
      .select()
      .single();

    if (error) {
      console.error("❌ sync-login upsert error:", error);
      throw new Error(error.message);
    }

    // Also fetch user's org membership
    let { data: membership } = await supabase
      .from("org_members")
      .select("role, clerk_org_id, organization_id")
      .eq("clerk_user_id", clerk_user_id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    // Fallback: if no org_members record but profile has organization_id,
    // auto-create the org_members record (for invited users)
    if (!membership && data?.organization_id) {
      console.log(`🔧 sync-login: no org_members but profile has org_id ${data.organization_id}, creating membership...`);

      // Check if there's a pending invitation for this user
      const { data: invitation } = await supabase
        .from("user_invitations")
        .select("role, organization_id")
        .eq("email", email)
        .eq("organization_id", data.organization_id)
        .limit(1)
        .maybeSingle();

      const memberRole = invitation?.role || "seller";

      // Look up the clerk_org_id from clerk_organizations
      const { data: clerkOrgRecord } = await supabase
        .from("clerk_organizations")
        .select("clerk_org_id")
        .eq("id", data.organization_id)
        .maybeSingle();

      const { error: memberInsertErr } = await supabase
        .from("org_members")
        .upsert(
          {
            organization_id: data.organization_id,
            clerk_org_id: clerkOrgRecord?.clerk_org_id || "unknown",
            clerk_user_id,
            role: memberRole,
            status: "active",
          },
          { onConflict: "clerk_org_id,clerk_user_id" }
        );

      if (memberInsertErr) {
        console.warn("⚠️ sync-login: auto-create org_members failed:", memberInsertErr.message);
      } else {
        membership = {
          role: memberRole,
          clerk_org_id: clerkOrgRecord?.clerk_org_id || "unknown",
          organization_id: data.organization_id,
        };
        console.log("✅ sync-login: auto-created org_members for invited user");

        // Mark invitation as accepted if exists
        if (invitation) {
          await supabase
            .from("user_invitations")
            .update({ status: "accepted" })
            .eq("email", email)
            .eq("organization_id", data.organization_id)
            .eq("status", "pending");
        }
      }
    }

    console.log(`✅ sync-login complete for ${clerk_user_id}`);

    return new Response(
      JSON.stringify({
        ok: true,
        profile: data,
        membership: membership || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("❌ sync-login error:", err.message);
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
