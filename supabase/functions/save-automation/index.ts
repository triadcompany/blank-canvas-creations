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
    const { automation_id, nodes, edges } = await req.json();

    if (!automation_id || !nodes || !edges) {
      return new Response(JSON.stringify({ error: "automation_id, nodes, and edges are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify automation belongs to org
    const { data: automation } = await supabase
      .from("automations")
      .select("id, organization_id")
      .eq("id", automation_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!automation) {
      return new Response(JSON.stringify({ error: "Automation not found in your organization" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate: only 1 trigger node
    const triggers = (nodes as any[]).filter((n: any) => n.type === "trigger");
    if (triggers.length > 1) {
      return new Response(JSON.stringify({ error: "Only 1 trigger node allowed per automation" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const entryNodeId = triggers.length === 1 ? triggers[0].id : null;

    // Upsert flow
    const { data: existingFlow } = await supabase
      .from("automation_flows")
      .select("id, version")
      .eq("automation_id", automation_id)
      .eq("organization_id", orgId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newVersion = (existingFlow?.version || 0) + 1;

    let flowResult;
    if (existingFlow) {
      const { data, error } = await supabase
        .from("automation_flows")
        .update({
          nodes: nodes,
          edges: edges,
          entry_node_id: entryNodeId,
          version: newVersion,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingFlow.id)
        .select()
        .single();
      if (error) throw error;
      flowResult = data;
    } else {
      const { data, error } = await supabase
        .from("automation_flows")
        .insert({
          automation_id,
          organization_id: orgId,
          nodes: nodes,
          edges: edges,
          entry_node_id: entryNodeId,
          version: 1,
        })
        .select()
        .single();
      if (error) throw error;
      flowResult = data;
    }

    return new Response(
      JSON.stringify({ ok: true, flow: flowResult }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("❌ save-automation:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
