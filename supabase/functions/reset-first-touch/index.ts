import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Normalise phone to digits-only (same logic used in evolution-webhook) */
function normalizePhone(raw: string): string {
  return (raw || "").replace(/[\s\-\+\(\)]/g, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Authenticate user
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get profile + org
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile?.organization_id) {
    return new Response(JSON.stringify({ ok: false, error: "no_organization" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const orgId = profile.organization_id;

  try {
    const url = new URL(req.url);

    // ─── GET: status check ───
    if (req.method === "GET") {
      const rawPhone = url.searchParams.get("phone") || "";
      const phone = normalizePhone(rawPhone);

      if (!phone) {
        return respond({ ok: false, error: "phone is required" }, 400);
      }

      const { data: rows, error } = await supabase
        .from("whatsapp_first_touch")
        .select("id, phone, created_at, first_message_id")
        .eq("organization_id", orgId)
        .eq("phone", phone)
        .limit(10);

      if (error) throw error;

      return respond({
        ok: true,
        org_id: orgId,
        phone,
        phone_raw: rawPhone,
        exists: (rows?.length || 0) > 0,
        rows: rows || [],
      });
    }

    // ─── POST: reset ───
    if (req.method === "POST") {
      const body = await req.json();
      const rawPhone = body.phone || "";
      const phone = normalizePhone(rawPhone);
      const channel = body.channel || null;

      if (!phone) {
        return respond({ ok: false, error: "phone is required" }, 400);
      }

      // First fetch rows to return details
      let query = supabase
        .from("whatsapp_first_touch")
        .select("id, phone, created_at, first_message_id")
        .eq("organization_id", orgId)
        .eq("phone", phone);

      const { data: beforeRows } = await query.limit(10);

      // Delete
      let deleteQuery = supabase
        .from("whatsapp_first_touch")
        .delete()
        .eq("organization_id", orgId)
        .eq("phone", phone);

      const { error: delError, count } = await deleteQuery.select("id");

      if (delError) throw delError;

      const deletedCount = beforeRows?.length || 0;

      console.log(
        `[reset-first-touch] org=${orgId} phone=${phone} deleted=${deletedCount} channel=${channel || "all"}`
      );

      if (deletedCount === 0) {
        console.log(
          `[reset-first-touch] WARNING: nothing deleted. Possible phone mismatch or already reset. raw="${rawPhone}" normalized="${phone}"`
        );
      }

      return respond({
        ok: true,
        org_id: orgId,
        phone,
        phone_raw: rawPhone,
        deleted_count: deletedCount,
        deleted_rows: (beforeRows || []).slice(0, 10),
        now_can_trigger_first_message: true,
      });
    }

    return respond({ ok: false, error: "method not allowed" }, 405);
  } catch (err: any) {
    console.error("[reset-first-touch] Error:", err);
    return respond({ ok: false, error: err.message }, 500);
  }

  function respond(data: any, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
