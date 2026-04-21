// Updates a Clerk organization's name and (optionally) logo via Clerk Backend API.
// Requires CLERK_SECRET_KEY. Validates that caller is admin of the org locally
// (via org_members) before forwarding the update to Clerk.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clerkKey = Deno.env.get("CLERK_SECRET_KEY");
    if (!clerkKey) {
      return new Response(JSON.stringify({ error: "Missing CLERK_SECRET_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const clerkUserId: string = body?.clerk_user_id || "";
    const organizationId: string = body?.organization_id || "";
    const name: string = (body?.name || "").trim();
    const logoUrl: string | null = body?.logo_url || null;

    if (!clerkUserId || !organizationId || !name) {
      return new Response(
        JSON.stringify({ error: "Missing clerk_user_id, organization_id or name" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify admin role in this org
    const { data: member } = await admin
      .from("org_members")
      .select("role, status")
      .eq("clerk_user_id", clerkUserId)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .maybeSingle();

    if (!member || member.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve Clerk org id
    const { data: clerkOrg } = await admin
      .from("clerk_organizations")
      .select("clerk_org_id")
      .eq("id", organizationId)
      .maybeSingle();

    const clerkOrgId = clerkOrg?.clerk_org_id;
    if (!clerkOrgId) {
      return new Response(
        JSON.stringify({ error: "Clerk organization mapping not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1) Update name
    const nameRes = await fetch(`https://api.clerk.com/v1/organizations/${clerkOrgId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${clerkKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });

    const nameJson = await nameRes.json().catch(() => ({}));
    if (!nameRes.ok) {
      return new Response(
        JSON.stringify({ error: nameJson?.errors?.[0]?.message || `Clerk API ${nameRes.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2) Update logo (best-effort). If logoUrl present, fetch the file and PUT
    //    it as multipart/form-data to Clerk's /logo endpoint. Failures here
    //    don't block the name update success.
    let logoStatus: string = "skipped";
    let logoError: string | null = null;
    if (logoUrl) {
      try {
        const imgRes = await fetch(logoUrl);
        if (!imgRes.ok) throw new Error(`Failed to fetch logo (HTTP ${imgRes.status})`);
        const blob = await imgRes.blob();
        const contentType = imgRes.headers.get("content-type") || "image/png";
        const ext = contentType.split("/")[1]?.split("+")[0] || "png";
        const fileName = `logo.${ext}`;

        const fd = new FormData();
        fd.append("file", new File([blob], fileName, { type: contentType }));
        fd.append("uploader_user_id", clerkUserId);

        const logoRes = await fetch(
          `https://api.clerk.com/v1/organizations/${clerkOrgId}/logo`,
          {
            method: "PUT",
            headers: { Authorization: `Bearer ${clerkKey}` },
            body: fd,
          },
        );
        const logoJson = await logoRes.json().catch(() => ({}));
        if (!logoRes.ok) {
          logoStatus = "failed";
          logoError = logoJson?.errors?.[0]?.message || `Clerk logo API ${logoRes.status}`;
          console.error("Clerk logo upload failed:", logoError, logoJson);
        } else {
          logoStatus = "uploaded";
        }
      } catch (e: any) {
        logoStatus = "failed";
        logoError = e?.message || "Unknown logo error";
        console.error("Clerk logo upload threw:", e);
      }
    } else {
      // Remove logo if user cleared it
      try {
        const delRes = await fetch(
          `https://api.clerk.com/v1/organizations/${clerkOrgId}/logo`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${clerkKey}` },
          },
        );
        logoStatus = delRes.ok ? "deleted" : "delete_failed";
      } catch {
        logoStatus = "delete_failed";
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        clerk_org_id: clerkOrgId,
        name: nameJson?.name || name,
        logo_status: logoStatus,
        logo_error: logoError,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
