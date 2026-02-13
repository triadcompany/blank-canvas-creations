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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user via anon client
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clerkUserId = claimsData.claims.sub as string;

    // Service client for validated operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get org_id and role
    const { data: member } = await supabase
      .from("org_members")
      .select("organization_id, role")
      .eq("clerk_user_id", clerkUserId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: "No organization membership" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgId = member.organization_id;
    const role = member.role;

    if (!["admin", "seller"].includes(role)) {
      return new Response(JSON.stringify({ error: "Invalid role" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { lead_id, new_value } = await req.json();

    if (!lead_id || new_value === undefined || new_value === null) {
      return new Response(JSON.stringify({ error: "lead_id and new_value are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (typeof new_value !== "number" || new_value < 0) {
      return new Response(JSON.stringify({ error: "new_value must be a non-negative number" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify lead belongs to org
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, organization_id")
      .eq("id", lead_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (leadError || !lead) {
      return new Response(JSON.stringify({ error: "Lead not found in your organization" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update sale value
    const { error: updateError } = await supabase
      .from("leads")
      .update({ valor_negocio: new_value })
      .eq("id", lead_id)
      .eq("organization_id", orgId);

    if (updateError) {
      console.error("❌ update-sale-value error:", updateError);
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("❌ update-sale-value:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
