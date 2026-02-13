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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: member } = await supabase
      .from("org_members")
      .select("organization_id, role")
      .eq("clerk_user_id", clerkUserId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (!member || !["admin", "seller"].includes(member.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgId = member.organization_id;
    const { lead_id, new_stage_id } = await req.json();

    if (!lead_id || !new_stage_id) {
      return new Response(JSON.stringify({ error: "lead_id and new_stage_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify lead belongs to org
    const { data: lead } = await supabase
      .from("leads")
      .select("id, stage_id")
      .eq("id", lead_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!lead) {
      return new Response(JSON.stringify({ error: "Lead not found in your organization" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify stage belongs to org's pipeline
    const { data: stage } = await supabase
      .from("pipeline_stages")
      .select("id, pipeline_id")
      .eq("id", new_stage_id)
      .maybeSingle();

    if (!stage) {
      return new Response(JSON.stringify({ error: "Stage not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify pipeline belongs to org
    const { data: pipeline } = await supabase
      .from("pipelines")
      .select("id")
      .eq("id", stage.pipeline_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!pipeline) {
      return new Response(JSON.stringify({ error: "Pipeline not in your organization" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateError } = await supabase
      .from("leads")
      .update({ stage_id: new_stage_id })
      .eq("id", lead_id)
      .eq("organization_id", orgId);

    if (updateError) {
      console.error("❌ change-lead-status error:", updateError);
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, old_stage_id: lead.stage_id, new_stage_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("❌ change-lead-status:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
