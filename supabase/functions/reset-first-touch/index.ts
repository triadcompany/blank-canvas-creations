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

function respond(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const url = new URL(req.url);

    // ─── GET: status check ───
    if (req.method === "GET") {
      const orgId = url.searchParams.get("organization_id") || "";
      const rawPhone = url.searchParams.get("phone") || "";
      const phone = normalizePhone(rawPhone);

      if (!orgId || !phone) {
        return respond({ ok: false, error: "organization_id and phone are required" }, 400);
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
      const orgId = body.organization_id || "";
      const rawPhone = body.phone || "";
      const phone = normalizePhone(rawPhone);
      const channel = body.channel || null;

      if (!orgId || !phone) {
        return respond({ ok: false, error: "organization_id and phone are required" }, 400);
      }

      // First fetch rows to return details
      const { data: beforeRows } = await supabase
        .from("whatsapp_first_touch")
        .select("id, phone, created_at, first_message_id")
        .eq("organization_id", orgId)
        .eq("phone", phone)
        .limit(10);

      // Delete
      await supabase
        .from("whatsapp_first_touch")
        .delete()
        .eq("organization_id", orgId)
        .eq("phone", phone);

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
});
