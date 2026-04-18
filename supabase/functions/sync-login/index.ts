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
    const { clerk_user_id, email, full_name, avatar_url, invitation_token } = await req.json();

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

    // ── Auto-accept pending invitation ──
    // Runs right after email verification: if user has a pending invitation,
    // create org_members + accept invitation, skipping the create-company screen.
    // Priority: 1) explicit invitation_token (survives email casing/alias differences)
    //           2) fallback to email match
    if (!membership && (invitation_token || email)) {
      let pendingInviteQuery = supabase
        .from("user_invitations")
        .select("id, organization_id, role, name, expires_at, email")
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString());

      if (invitation_token) {
        console.log(`🔑 sync-login: looking up invitation by token`);
        pendingInviteQuery = pendingInviteQuery.eq("token", invitation_token);
      } else {
        pendingInviteQuery = pendingInviteQuery.eq("email", email);
      }

      const { data: pendingInvite } = await pendingInviteQuery
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingInvite?.organization_id) {
        console.log(`📨 sync-login: pending invitation found for ${email} → org ${pendingInvite.organization_id}`);

        const { data: clerkOrgRecord } = await supabase
          .from("clerk_organizations")
          .select("clerk_org_id")
          .eq("id", pendingInvite.organization_id)
          .maybeSingle();

        // Ensure profile exists with the org_id (so AppGate sees orgId)
        await supabase
          .from("profiles")
          .upsert(
            {
              clerk_user_id,
              email: email || null,
              name: pendingInvite.name || full_name || null,
              avatar_url: avatar_url || null,
              organization_id: pendingInvite.organization_id,
              onboarding_completed: true,
            },
            { onConflict: "clerk_user_id" }
          );

        const { error: memberErr } = await supabase
          .from("org_members")
          .upsert(
            {
              organization_id: pendingInvite.organization_id,
              clerk_org_id: clerkOrgRecord?.clerk_org_id || "unknown",
              clerk_user_id,
              role: pendingInvite.role || "seller",
              status: "active",
            },
            { onConflict: "clerk_org_id,clerk_user_id" }
          );

        if (memberErr) {
          console.warn("⚠️ sync-login: invite auto-accept org_members failed:", memberErr.message);
        } else {
          // Mark invitation accepted
          await supabase
            .from("user_invitations")
            .update({ status: "accepted", accepted_at: new Date().toISOString() })
            .eq("id", pendingInvite.id);

          // Best-effort user_roles insert
          await supabase
            .from("user_roles")
            .insert({
              clerk_user_id,
              organization_id: pendingInvite.organization_id,
              role: pendingInvite.role || "seller",
            })
            .then(({ error }) => {
              if (error && !error.message.includes("duplicate")) {
                console.warn("⚠️ sync-login: user_roles insert warning:", error.message);
              }
            });

          membership = {
            role: pendingInvite.role || "seller",
            clerk_org_id: clerkOrgRecord?.clerk_org_id || "unknown",
            organization_id: pendingInvite.organization_id,
          };
          console.log("✅ sync-login: invitation auto-accepted, user joined org");
        }
      }
    }

    // Fallback: if no org_members record, check profiles table for organization_id
    // (for invited users whose profile was created with org_id but no org_members)
    if (!membership) {
      const { data: profileRecord } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("clerk_user_id", clerk_user_id)
        .maybeSingle();

      const profileOrgId = profileRecord?.organization_id;

      if (profileOrgId) {
        console.log(`🔧 sync-login: no org_members but profiles has org_id ${profileOrgId}, creating membership...`);

        // Check if there's a pending invitation for this user
        const { data: invitation } = await supabase
          .from("user_invitations")
          .select("role, organization_id")
          .eq("email", email)
          .eq("organization_id", profileOrgId)
          .limit(1)
          .maybeSingle();

        const memberRole = invitation?.role || "seller";

        // Look up the clerk_org_id from clerk_organizations
        const { data: clerkOrgRecord } = await supabase
          .from("clerk_organizations")
          .select("clerk_org_id")
          .eq("id", profileOrgId)
          .maybeSingle();

        const { error: memberInsertErr } = await supabase
          .from("org_members")
          .upsert(
            {
              organization_id: profileOrgId,
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
            organization_id: profileOrgId,
          };
          console.log("✅ sync-login: auto-created org_members for invited user");

          // Mark invitation as accepted if exists
          if (invitation) {
            await supabase
              .from("user_invitations")
              .update({ status: "accepted" })
              .eq("email", email)
              .eq("organization_id", profileOrgId)
              .eq("status", "pending");
          }
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
