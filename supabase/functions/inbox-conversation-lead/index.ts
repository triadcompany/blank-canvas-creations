import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversation_id");

    if (!conversationId) {
      return new Response(JSON.stringify({ error: "conversation_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get conversation with lead info
    const { data: conv, error: convError } = await supabase
      .from("conversations")
      .select("id, contact_phone, lead_id")
      .eq("id", conversationId)
      .single();

    if (convError || !conv) {
      return new Response(JSON.stringify({ lead: null, conversation_found: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!conv.lead_id) {
      return new Response(JSON.stringify({ lead: null, conversation_found: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch lead with stage info
    const { data: lead } = await supabase
      .from("leads")
      .select("*, stage:pipeline_stages!stage_id(id, name, pipeline_id)")
      .eq("id", conv.lead_id)
      .single();

    return new Response(JSON.stringify({
      lead: lead || null,
      conversation_found: true,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
