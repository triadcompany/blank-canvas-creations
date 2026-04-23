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

    console.log(`🔄 sync-login for user: ${clerk_user_id}${invitation_token ? " (with invitation token)" : ""}`);

    // Resolve a usable display name & email — profiles.name and profiles.email
    // are NOT NULL, so we always need a fallback before any upsert.
    const safeEmail = email || `${clerk_user_id}@no-email.local`;
    const safeName = full_name || (email ? email.split("@")[0] : null) || "Usuário";

    // Upsert users_profile (Clerk mirror) with last_login_at
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
      console.error("❌ sync-login users_profile upsert error:", error);
      throw new Error(error.message);
    }

    // ── SAFETY NET: ensure a profiles row ALWAYS exists for this user.
    // Without this, an interrupted onboarding leaves the user stuck and the
    // app shows a generic "user not found" error on subsequent logins.
    // organization_id is nullable, so we can create the profile even when the
    // user has not joined an org yet — they will simply be sent to /onboarding.
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id, organization_id")
      .eq("clerk_user_id", clerk_user_id)
      .maybeSingle();

    if (!existingProfile) {
      console.log(`🆕 sync-login: creating missing profile for ${clerk_user_id}`);
      const { error: profileInsertErr } = await supabase
        .from("profiles")
        .insert({
          clerk_user_id,
          email: safeEmail,
          name: safeName,
          avatar_url: avatar_url || null,
          organization_id: null,
          onboarding_completed: false,
        });
      if (profileInsertErr && !profileInsertErr.message.includes("duplicate")) {
        console.error("⚠️ sync-login: profile insert failed:", profileInsertErr.message);
      }
    }

    // ── SHORT-CIRCUIT: if the user already has a profiles.organization_id
    // AND a matching org_members row, return immediately. Do NOT search for
    // any other membership — that would override the user's currently-active
    // organization (the one they switched to in the org switcher).
    // The only exception is when an invitation_token is present, which means
    // the user is explicitly accepting an invite to a NEW org.
    if (!invitation_token) {
      const { data: currentProfile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("clerk_user_id", clerk_user_id)
        .maybeSingle();

      if (currentProfile?.organization_id) {
        const { data: currentMember } = await supabase
          .from("org_members")
          .select("role, clerk_org_id, organization_id")
          .eq("clerk_user_id", clerk_user_id)
          .eq("organization_id", currentProfile.organization_id)
          .eq("status", "active")
          .maybeSingle();

        if (currentMember) {
          console.log(`✅ sync-login: respecting active org ${currentProfile.organization_id} from profiles`);
          return new Response(
            JSON.stringify({
              ok: true,
              profile: data,
              membership: currentMember,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    let membership: { role: string; clerk_org_id: string; organization_id: string } | null = null;

    // ── PRIORITY 1: Process invitation_token if present (works for existing users joining new orgs) ──
    if (invitation_token) {
      console.log(`🔑 sync-login: looking up invitation by token`);
      const { data: pendingInvite } = await supabase
        .from("user_invitations")
        .select("id, organization_id, role, name, expires_at, email")
        .eq("token", invitation_token)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingInvite?.organization_id) {
        console.log(`📨 sync-login: token-based invite found → org ${pendingInvite.organization_id}`);

        const { data: clerkOrgRecord } = await supabase
          .from("clerk_organizations")
          .select("clerk_org_id")
          .eq("id", pendingInvite.organization_id)
          .maybeSingle();

        // Switch the user's primary organization to the new one
        await supabase
          .from("profiles")
          .upsert(
            {
              clerk_user_id,
              email: safeEmail,
              name: pendingInvite.name || safeName,
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
          await supabase
            .from("user_invitations")
            .update({ status: "accepted", accepted_at: new Date().toISOString() })
            .eq("id", pendingInvite.id);

          await supabase
            .from("user_roles")
            .upsert(
              {
                clerk_user_id,
                organization_id: pendingInvite.organization_id,
                role: pendingInvite.role || "seller",
              },
              { onConflict: "clerk_user_id,organization_id" }
            )
            .then(({ error }) => {
              if (error && !error.message.includes("duplicate")) {
                console.warn("⚠️ sync-login: user_roles upsert warning:", error.message);
              }
            });

          membership = {
            role: pendingInvite.role || "seller",
            clerk_org_id: clerkOrgRecord?.clerk_org_id || "unknown",
            organization_id: pendingInvite.organization_id,
          };
          console.log("✅ sync-login: token-based invitation auto-accepted, user joined new org");
        }
      } else {
        console.log("⚠️ sync-login: token provided but no matching pending invitation");
      }
    }

    // ── If no membership from token, fetch existing membership ──
    // IMPORTANT: prefer the membership that matches profiles.organization_id
    // (the user's currently-active org). Otherwise, with multiple memberships,
    // we'd return an arbitrary one and override the user's switch in the UI.
    if (!membership) {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("clerk_user_id", clerk_user_id)
        .maybeSingle();

      const activeOrgId = profileRow?.organization_id;

      if (activeOrgId) {
        const { data: activeMembership } = await supabase
          .from("org_members")
          .select("role, clerk_org_id, organization_id")
          .eq("clerk_user_id", clerk_user_id)
          .eq("status", "active")
          .eq("organization_id", activeOrgId)
          .limit(1)
          .maybeSingle();
        if (activeMembership) membership = activeMembership as any;
      }

      // Fallback: any active membership (legacy users without profile.org_id)
      if (!membership) {
        const { data: anyMembership } = await supabase
          .from("org_members")
          .select("role, clerk_org_id, organization_id")
          .eq("clerk_user_id", clerk_user_id)
          .eq("status", "active")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (anyMembership) membership = anyMembership as any;
      }
    }

    // ── Fallback: pending invitation by email (only if still no membership) ──
    if (!membership && email) {
      const { data: pendingInvite } = await supabase
        .from("user_invitations")
        .select("id, organization_id, role, name, expires_at, email")
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .eq("email", email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingInvite?.organization_id) {
        console.log(`📨 sync-login: email-based invite found → org ${pendingInvite.organization_id}`);

        const { data: clerkOrgRecord } = await supabase
          .from("clerk_organizations")
          .select("clerk_org_id")
          .eq("id", pendingInvite.organization_id)
          .maybeSingle();

        await supabase
          .from("profiles")
          .upsert(
            {
              clerk_user_id,
              email: safeEmail,
              name: pendingInvite.name || safeName,
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

        if (!memberErr) {
          await supabase
            .from("user_invitations")
            .update({ status: "accepted", accepted_at: new Date().toISOString() })
            .eq("id", pendingInvite.id);

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
        }
      }
    }

    // Fallback: profile has org_id but no org_members
    if (!membership) {
      const { data: profileRecord } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("clerk_user_id", clerk_user_id)
        .maybeSingle();

      const profileOrgId = profileRecord?.organization_id;

      if (profileOrgId) {
        console.log(`🔧 sync-login: no org_members but profiles has org_id ${profileOrgId}, creating membership...`);

        const { data: invitation } = await supabase
          .from("user_invitations")
          .select("role, organization_id")
          .eq("email", email)
          .eq("organization_id", profileOrgId)
          .limit(1)
          .maybeSingle();

        const memberRole = invitation?.role || "seller";

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

        if (!memberInsertErr) {
          membership = {
            role: memberRole,
            clerk_org_id: clerkOrgRecord?.clerk_org_id || "unknown",
            organization_id: profileOrgId,
          };

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
