import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // All actions require org_id
    const body = req.method === "POST" ? await req.json() : {};
    const orgId = url.searchParams.get("org_id") || body.organization_id;

    if (!orgId) {
      return respond({ error: "org_id query param or organization_id in body required" }, 400);
    }

    // ──── ACTION: org-context ────
    if (action === "org-context") {
      const profileId = url.searchParams.get("profile_id") || body.profile_id;

      const [orgResult, profileResult, integrationResult] = await Promise.all([
        supabase.from("organizations").select("id, name, is_active, created_at").eq("id", orgId).maybeSingle(),
        profileId
          ? supabase.from("profiles").select("id, name, email, organization_id, clerk_user_id").eq("id", profileId).maybeSingle()
          : supabase.from("profiles").select("id, name, email, organization_id, clerk_user_id").eq("organization_id", orgId).limit(5),
        supabase.from("whatsapp_integrations").select("id, instance_name, status, phone_number, connected_at, organization_id").eq("organization_id", orgId),
      ]);

      const roleResult = await supabase.from("user_roles").select("user_id, role, organization_id").eq("organization_id", orgId);

      return respond({
        organization: orgResult.data,
        profiles: profileId ? (profileResult.data ? [profileResult.data] : []) : (profileResult.data || []),
        roles: roleResult.data || [],
        whatsapp_integrations: integrationResult.data || [],
        diagnostics: {
          org_exists: !!orgResult.data,
          org_active: orgResult.data?.is_active ?? false,
          profiles_count: profileId ? (profileResult.data ? 1 : 0) : (profileResult.data?.length || 0),
          integrations_count: integrationResult.data?.length || 0,
          has_connected_whatsapp: (integrationResult.data || []).some((i: any) => i.status === "connected"),
        },
      });
    }

    // ──── ACTION: inbox-stats ────
    if (action === "inbox-stats") {
      const [convResult, msgResult, last5Conv, integrationResult] = await Promise.all([
        supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase.from("messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase
          .from("conversations")
          .select("id, contact_phone, contact_name, assigned_to, last_message_at, instance_name, unread_count, created_at")
          .eq("organization_id", orgId)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(5),
        supabase.from("whatsapp_integrations").select("instance_name, status, organization_id").eq("organization_id", orgId),
      ]);

      return respond({
        organizationId: orgId,
        conversationsCount: convResult.count || 0,
        messagesCount: msgResult.count || 0,
        last5Conversations: (last5Conv.data || []).map((c: any) => ({
          id: c.id,
          contactPhone: c.contact_phone,
          contactName: c.contact_name,
          assignedTo: c.assigned_to,
          lastMessageAt: c.last_message_at,
          instanceName: c.instance_name,
          unreadCount: c.unread_count,
          createdAt: c.created_at,
          organizationId: orgId,
        })),
        registeredInstances: integrationResult.data || [],
      });
    }

    // ──── ACTION: last-evolution-events ────
    if (action === "last-evolution-events") {
      const { data: logs, error } = await supabase
        .from("evolution_webhook_logs")
        .select("*")
        .eq("detected_organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(20);

      // Also get events where org was NOT detected (useful for debugging)
      const { data: unlinkedLogs } = await supabase
        .from("evolution_webhook_logs")
        .select("*")
        .is("detected_organization_id", null)
        .order("created_at", { ascending: false })
        .limit(10);

      return respond({
        organizationId: orgId,
        eventsForOrg: (logs || []).map((l: any) => ({
          id: l.id,
          instanceName: l.instance_name,
          eventType: l.event_type,
          remoteJid: l.remote_jid,
          detectedOrganizationId: l.detected_organization_id,
          processingResult: l.processing_result,
          errorMessage: l.error_message,
          createdAt: l.created_at,
        })),
        unlinkedEvents: (unlinkedLogs || []).map((l: any) => ({
          id: l.id,
          instanceName: l.instance_name,
          eventType: l.event_type,
          remoteJid: l.remote_jid,
          errorMessage: l.error_message,
          createdAt: l.created_at,
        })),
        error: error?.message || null,
      });
    }

    return respond({ error: `Unknown action: ${action}. Use org-context, inbox-stats, or last-evolution-events` }, 400);
  } catch (err) {
    console.error("[admin-debug] Error:", err);
    return respond({ error: String(err) }, 500);
  }
});
