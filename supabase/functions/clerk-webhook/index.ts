import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, svix-id, svix-signature, svix-timestamp",
};

// Svix signature verification
async function verifyWebhookSignature(
  payload: string,
  headers: Headers,
  secret: string
): Promise<boolean> {
  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error("Missing svix headers");
    return false;
  }

  // Check timestamp tolerance (5 minutes)
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(svixTimestamp, 10);
  if (Math.abs(now - ts) > 300) {
    console.error("Webhook timestamp too old or too new");
    return false;
  }

  // Decode the secret (remove whsec_ prefix and base64 decode)
  const secretBytes = Uint8Array.from(
    atob(secret.startsWith("whsec_") ? secret.slice(6) : secret),
    (c) => c.charCodeAt(0)
  );

  // Create signed content
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const encoder = new TextEncoder();

  // Import key and sign
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedContent)
  );

  // Base64 encode
  const computedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signatureBytes))
  );

  // Compare with all provided signatures (space-separated, prefixed with v1,)
  const signatures = svixSignature.split(" ");
  for (const sig of signatures) {
    const [version, sigValue] = sig.split(",");
    if (version === "v1" && sigValue === computedSignature) {
      return true;
    }
  }

  console.error("Webhook signature mismatch");
  return false;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const secret = Deno.env.get("CLERK_WEBHOOK_SECRET");
  if (!secret) {
    console.error("CLERK_WEBHOOK_SECRET not configured");
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders });
  }

  // Read body as text for signature verification
  const body = await req.text();

  // Verify signature
  const isValid = await verifyWebhookSignature(body, req.headers, secret);
  if (!isValid) {
    return new Response("Invalid signature", { status: 401, headers: corsHeaders });
  }

  // Parse event
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  const eventType = event.type as string;
  const eventData = event.data;
  const eventId = event.id || "unknown";

  console.log(`📩 Clerk webhook: type=${eventType} id=${eventId}`);

  // Supabase service role client
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    switch (eventType) {
      // ========== ORGANIZATION EVENTS ==========
      case "organization.created":
      case "organization.updated": {
        const clerkOrgId = eventData.id;
        const name = eventData.name || "Unnamed";
        const slug = eventData.slug || null;

        const { error } = await supabase
          .from("clerk_organizations")
          .upsert(
            { clerk_org_id: clerkOrgId, name, slug, deleted_at: null },
            { onConflict: "clerk_org_id" }
          );

        if (error) {
          console.error("❌ Error upserting organization:", error);
          throw error;
        }
        console.log(`✅ Organization upserted: ${clerkOrgId}`);
        break;
      }

      case "organization.deleted": {
        const clerkOrgId = eventData.id;
        // Soft delete
        const { error } = await supabase
          .from("clerk_organizations")
          .update({ deleted_at: new Date().toISOString() })
          .eq("clerk_org_id", clerkOrgId);

        if (error) {
          console.error("❌ Error soft-deleting organization:", error);
          throw error;
        }
        console.log(`🗑️ Organization soft-deleted: ${clerkOrgId}`);
        break;
      }

      // ========== MEMBERSHIP EVENTS ==========
      case "organizationMembership.created":
      case "organizationMembership.updated": {
        const clerkOrgId = eventData.organization?.id;
        const clerkUserId = eventData.public_user_data?.user_id;
        const clerkRole = eventData.role;

        if (!clerkOrgId || !clerkUserId) {
          console.error("❌ Missing org or user id in membership event");
          break;
        }

        // Map Clerk role to our roles (org:admin -> admin, everything else -> seller)
        const role = clerkRole === "org:admin" ? "admin" : "seller";

        // Ensure organization exists (upsert)
        const orgName = eventData.organization?.name || "Unnamed";
        const orgSlug = eventData.organization?.slug || null;
        const { data: orgData, error: orgError } = await supabase
          .from("clerk_organizations")
          .upsert(
            { clerk_org_id: clerkOrgId, name: orgName, slug: orgSlug, deleted_at: null },
            { onConflict: "clerk_org_id" }
          )
          .select("id")
          .single();

        if (orgError) {
          console.error("❌ Error upserting org for membership:", orgError);
          throw orgError;
        }

        // Upsert member
        const { error: memberError } = await supabase
          .from("org_members")
          .upsert(
            {
              organization_id: orgData.id,
              clerk_org_id: clerkOrgId,
              clerk_user_id: clerkUserId,
              role,
            },
            { onConflict: "clerk_org_id,clerk_user_id" }
          );

        if (memberError) {
          console.error("❌ Error upserting member:", memberError);
          throw memberError;
        }
        console.log(`✅ Member upserted: ${clerkUserId} in ${clerkOrgId} as ${role}`);
        break;
      }

      case "organizationMembership.deleted": {
        const clerkOrgId = eventData.organization?.id;
        const clerkUserId = eventData.public_user_data?.user_id;

        if (!clerkOrgId || !clerkUserId) {
          console.error("❌ Missing org or user id in membership delete");
          break;
        }

        const { error } = await supabase
          .from("org_members")
          .delete()
          .eq("clerk_org_id", clerkOrgId)
          .eq("clerk_user_id", clerkUserId);

        if (error) {
          console.error("❌ Error deleting member:", error);
          throw error;
        }
        console.log(`🗑️ Member removed: ${clerkUserId} from ${clerkOrgId}`);
        break;
      }

      // ========== USER EVENTS ==========
      case "user.created":
      case "user.updated": {
        const clerkUserId = eventData.id;
        const email =
          eventData.email_addresses?.find(
            (e: any) => e.id === eventData.primary_email_address_id
          )?.email_address || null;
        const fullName =
          [eventData.first_name, eventData.last_name]
            .filter(Boolean)
            .join(" ") || null;
        const imageUrl = eventData.image_url || null;

        const { error } = await supabase
          .from("users_profile")
          .upsert(
            { clerk_user_id: clerkUserId, email, full_name: fullName, image_url: imageUrl },
            { onConflict: "clerk_user_id" }
          );

        if (error) {
          console.error("❌ Error upserting user profile:", error);
          throw error;
        }
        console.log(`✅ User profile upserted: ${clerkUserId}`);
        break;
      }

      default:
        console.log(`⏭️ Ignoring event type: ${eventType}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(`❌ Error processing ${eventType}:`, err.message);
    // Still return 200 to prevent Clerk from retrying indefinitely
    return new Response(JSON.stringify({ received: true, error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
