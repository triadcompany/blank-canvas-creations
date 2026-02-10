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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const url = new URL(req.url);
    const orgId = url.searchParams.get("org_id");

    if (!orgId) {
      return new Response(JSON.stringify({ error: "org_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [convResult, msgResult, last10Conv, last10Msg] = await Promise.all([
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
      supabase.from("messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
      supabase.from("conversations").select("id, contact_phone, assigned_to, last_message_at, created_at, instance_name").eq("organization_id", orgId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(10),
      supabase.from("messages").select("id, conversation_id, direction, created_at, body").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(10),
    ]);

    const result = {
      organizationId: orgId,
      totalConversations: convResult.count || 0,
      totalMessages: msgResult.count || 0,
      last10Conversations: (last10Conv.data || []).map((c: any) => ({
        id: c.id,
        contactPhone: c.contact_phone,
        assignedUserId: c.assigned_to,
        lastMessageAt: c.last_message_at,
        updatedAt: c.created_at,
        channelId: c.instance_name,
      })),
      last10Messages: (last10Msg.data || []).map((m: any) => ({
        id: m.id,
        conversationId: m.conversation_id,
        direction: m.direction,
        createdAt: m.created_at,
        textPreview: (m.body || "").substring(0, 100),
      })),
    };

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[inbox-debug] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
