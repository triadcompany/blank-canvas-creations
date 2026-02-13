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
    const { clerk_user_id, email, full_name, avatar_url, org_name, slug } = await req.json();

    if (!clerk_user_id) {
      return new Response(JSON.stringify({ error: "clerk_user_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`🚀 bootstrap-org for user: ${clerk_user_id}`);

    // 1. Upsert users_profile
    await supabase.from("users_profile").upsert(
      {
        clerk_user_id,
        email: email || null,
        full_name: full_name || null,
        avatar_url: avatar_url || null,
        last_login_at: new Date().toISOString(),
      },
      { onConflict: "clerk_user_id" }
    );

    // 2. Check if user already has an org membership in Supabase
    const { data: existingMember } = await supabase
      .from("org_members")
      .select("*, clerk_organizations:organization_id(id, clerk_org_id, name, slug)")
      .eq("clerk_user_id", clerk_user_id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (existingMember && existingMember.clerk_organizations) {
      const org = existingMember.clerk_organizations as any;
      console.log(`✅ User already has org: ${org.clerk_org_id}`);
      return new Response(
        JSON.stringify({
          ok: true,
          already_existed: true,
          org_id: org.id,
          clerk_org_id: org.clerk_org_id,
          role: existingMember.role,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Create Organization in Clerk
    const orgName = org_name || "Minha Organização";
    const orgSlug =
      slug ||
      orgName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") +
        "-" +
        Math.random().toString(36).slice(2, 7);

    console.log(`🏢 Creating Clerk org: ${orgName} (${orgSlug})`);

    const clerkOrgRes = await fetch("https://api.clerk.com/v1/organizations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: orgName,
        slug: orgSlug,
        created_by: clerk_user_id,
      }),
    });

    if (!clerkOrgRes.ok) {
      const errText = await clerkOrgRes.text();
      console.error("❌ Clerk org creation failed:", errText);
      throw new Error(`Clerk org creation failed: ${clerkOrgRes.status} - ${errText}`);
    }

    const clerkOrg = await clerkOrgRes.json();
    const clerkOrgId = clerkOrg.id;
    console.log(`✅ Clerk org created: ${clerkOrgId}`);

    // 4. Add user as admin member in Clerk
    const memberRes = await fetch(
      `https://api.clerk.com/v1/organizations/${clerkOrgId}/memberships`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clerkSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: clerk_user_id,
          role: "org:admin",
        }),
      }
    );

    if (!memberRes.ok) {
      const errText = await memberRes.text();
      // If already member, that's ok
      if (!errText.includes("already")) {
        console.error("❌ Clerk membership creation failed:", errText);
        throw new Error(`Clerk membership failed: ${memberRes.status} - ${errText}`);
      }
    }
    console.log(`✅ Clerk membership created`);

    // 5. Persist in Supabase: clerk_organizations
    const { data: orgData, error: orgError } = await supabase
      .from("clerk_organizations")
      .upsert(
        {
          clerk_org_id: clerkOrgId,
          name: orgName,
          slug: orgSlug,
          created_by_clerk_user_id: clerk_user_id,
        },
        { onConflict: "clerk_org_id" }
      )
      .select("id")
      .single();

    if (orgError) {
      console.error("❌ Supabase org upsert error:", orgError);
      throw new Error(orgError.message);
    }

    // 6. Persist in Supabase: org_members
    const { error: memberError } = await supabase.from("org_members").upsert(
      {
        organization_id: orgData.id,
        clerk_org_id: clerkOrgId,
        clerk_user_id,
        role: "admin",
        status: "active",
      },
      { onConflict: "clerk_org_id,clerk_user_id" }
    );

    if (memberError) {
      console.error("❌ Supabase member upsert error:", memberError);
      throw new Error(memberError.message);
    }

    console.log(`✅ bootstrap-org complete: org=${orgData.id}, clerk_org=${clerkOrgId}`);

    return new Response(
      JSON.stringify({
        ok: true,
        already_existed: false,
        org_id: orgData.id,
        clerk_org_id: clerkOrgId,
        role: "admin",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("❌ bootstrap-org error:", err.message);
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
