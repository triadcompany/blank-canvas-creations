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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // ──── AUTH: validate JWT and require admin membership of the requested org ────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return respond({ error: "Unauthorized" }, 401);
    }

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return respond({ error: "Invalid token" }, 401);
    }
    const clerkUserId = claimsData.claims.sub as string;

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const orgId = url.searchParams.get("org_id") || body.organization_id;

    if (!orgId) {
      return respond({ error: "org_id query param or organization_id in body required" }, 400);
    }

    // Verify caller is an active admin of the requested org
    const { data: member, error: memberError } = await supabase
      .from("org_members")
      .select("role, status, organization_id")
      .eq("clerk_user_id", clerkUserId)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .maybeSingle();

    if (memberError || !member || member.role !== "admin") {
      return respond({ error: "Forbidden: admin membership required for this organization" }, 403);
    }

    // ──── ACTION: org-context ────
    if (action === "org-context") {
      const profileId = url.searchParams.get("profile_id") || body.profile_id;

      const [orgResult, profileResult, integrationResult] = await Promise.all([
        supabase.from("organizations").select("id, name, is_active, created_at").eq("id", orgId).maybeSingle(),
        profileId
          ? supabase.from("profiles").select("id, name, email, organization_id, clerk_user_id").eq("id", profileId).maybeSingle()
          : supabase.from("profiles").select("id, name, email, organization_id, clerk_user_id").eq("organization_id", orgId).limit(5),
        supabase.from("whatsapp_integrations")
          .select("id, instance_name, status, phone_number, connected_at, organization_id, webhook_token, last_webhook_event_at, last_webhook_error")
          .eq("organization_id", orgId),
      ]);

      const roleResult = await supabase.from("user_roles").select("user_id, role, organization_id").eq("organization_id", orgId);

      // Build webhook diagnostics
      const integrations = integrationResult.data || [];
      const webhookDiagnostics = integrations.map((i: any) => {
        let webhook_status = "NOT_REGISTERED";
        if (i.webhook_token) {
          webhook_status = i.last_webhook_error ? "INVALID_TOKEN" : "OK";
        }
        return {
          instance_name: i.instance_name,
          webhook_status,
          has_token: !!i.webhook_token,
          last_webhook_event_at: i.last_webhook_event_at,
          last_webhook_error: i.last_webhook_error,
        };
      });

      return respond({
        organization: orgResult.data,
        profiles: profileId ? (profileResult.data ? [profileResult.data] : []) : (profileResult.data || []),
        roles: roleResult.data || [],
        whatsapp_integrations: integrations,
        webhook_diagnostics: webhookDiagnostics,
        diagnostics: {
          org_exists: !!orgResult.data,
          org_active: orgResult.data?.is_active ?? false,
          profiles_count: profileId ? (profileResult.data ? 1 : 0) : (profileResult.data?.length || 0),
          integrations_count: integrations.length,
          has_connected_whatsapp: integrations.some((i: any) => i.status === "connected"),
          has_webhook_token: integrations.some((i: any) => !!i.webhook_token),
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
        supabase.from("whatsapp_integrations")
          .select("instance_name, status, organization_id, webhook_token, last_webhook_event_at, last_webhook_error")
          .eq("organization_id", orgId),
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
        })),
        registeredInstances: (integrationResult.data || []).map((i: any) => ({
          instance_name: i.instance_name,
          status: i.status,
          webhook_status: i.webhook_token ? (i.last_webhook_error ? "INVALID_TOKEN" : "OK") : "NOT_REGISTERED",
          last_webhook_event_at: i.last_webhook_event_at,
          last_webhook_error: i.last_webhook_error,
        })),
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
          authStatus: l.auth_status,
          processingResult: l.processing_result,
          errorMessage: l.error_message,
          createdAt: l.created_at,
        })),
        unlinkedEvents: (unlinkedLogs || []).map((l: any) => ({
          id: l.id,
          instanceName: l.instance_name,
          eventType: l.event_type,
          remoteJid: l.remote_jid,
          authStatus: l.auth_status,
          errorMessage: l.error_message,
          createdAt: l.created_at,
        })),
        error: error?.message || null,
      });
    }

    // ──── ACTION: automation-events ────
    if (action === "automation-events") {
      const [eventsResult, runsResult] = await Promise.all([
        supabase
          .from("automation_events")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("automation_event_runs")
          .select("*")
          .eq("organization_id", orgId)
          .order("started_at", { ascending: false })
          .limit(20),
      ]);

      return respond({
        organizationId: orgId,
        events: (eventsResult.data || []).map((e: any) => ({
          id: e.id,
          eventName: e.event_name,
          entityType: e.entity_type,
          leadId: e.lead_id,
          conversationId: e.conversation_id,
          source: e.source,
          status: e.status,
          error: e.error,
          createdAt: e.created_at,
          processedAt: e.processed_at,
          idempotencyKey: e.idempotency_key,
        })),
        eventRuns: (runsResult.data || []).map((r: any) => ({
          id: r.id,
          automationEventId: r.automation_event_id,
          automationId: r.automation_id,
          status: r.status,
          skippedReason: r.skipped_reason,
          error: r.error,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
        })),
      });
    }

    return respond({ error: `Unknown action: ${action}. Use org-context, inbox-stats, last-evolution-events, or automation-events` }, 400);
  } catch (err) {
    console.error("[admin-debug] Error:", err);
    return respond({ error: "Internal server error" }, 500);
  }
});
