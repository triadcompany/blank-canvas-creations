import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tables that only admins can modify
const ADMIN_ONLY_TABLES = [
  "organizations",
  "webhook_configurations",
  "whatsapp_routing_settings",
  "whatsapp_routing_bucket_settings",
  "lead_distribution_settings",
  "pipelines",
] as const;

type AdminTable = typeof ADMIN_ONLY_TABLES[number];

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

    if (!member) {
      return new Response(JSON.stringify({ error: "No organization membership" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ADMIN ONLY
    if (member.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Apenas administradores podem editar estas configurações." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orgId = member.organization_id;
    const { table, record_id, updates } = await req.json();

    if (!table || !updates || typeof updates !== "object") {
      return new Response(JSON.stringify({ error: "table and updates are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate table is in allowed list
    if (!ADMIN_ONLY_TABLES.includes(table as AdminTable)) {
      return new Response(JSON.stringify({ error: `Table '${table}' is not a sensitive settings table` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build query — for org table use id, for others use organization_id
    const orgColumn = table === "organizations" ? "id" : "organization_id";

    if (record_id) {
      // Update specific record
      const { error: updateError } = await supabase
        .from(table)
        .update(updates)
        .eq("id", record_id)
        .eq(orgColumn, orgId);

      if (updateError) {
        console.error(`❌ update-sensitive-settings (${table}):`, updateError);
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // Update all records in org (e.g., org settings)
      const { error: updateError } = await supabase
        .from(table)
        .update(updates)
        .eq(orgColumn, orgId);

      if (updateError) {
        console.error(`❌ update-sensitive-settings (${table}):`, updateError);
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    console.log(`✅ update-sensitive-settings: ${table} updated by admin ${clerkUserId}`);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("❌ update-sensitive-settings:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
