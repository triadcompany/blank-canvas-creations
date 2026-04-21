// Edge function to upload organization logo using service role
// Validates that the caller is an admin of the organization via Clerk user ID
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-clerk-user-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const form = await req.formData();
    const clerkUserId = (form.get("clerk_user_id") as string) || "";
    const file = form.get("file") as File | null;

    if (!clerkUserId || !file) {
      return new Response(
        JSON.stringify({ error: "Missing clerk_user_id or file" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (file.size > 2 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File too large (max 2MB)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve org and verify admin role
    const { data: profile } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();

    const orgId = profile?.organization_id;
    if (!orgId) {
      return new Response(JSON.stringify({ error: "Organization not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: member } = await admin
      .from("org_members")
      .select("role, status")
      .eq("clerk_user_id", clerkUserId)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .maybeSingle();

    if (!member || member.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure bucket exists (idempotent)
    await admin.storage
      .createBucket("org-logos", { public: true })
      .catch(() => {});

    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${orgId}/logo-${Date.now()}.${ext}`;
    const buf = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await admin.storage
      .from("org-logos")
      .upload(path, buf, { upsert: true, contentType: file.type || "image/png" });

    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: pub } = admin.storage.from("org-logos").getPublicUrl(path);

    return new Response(
      JSON.stringify({ ok: true, path, public_url: pub.publicUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
