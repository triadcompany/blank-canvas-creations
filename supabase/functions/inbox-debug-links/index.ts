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

    const { data, error } = await supabase
      .from("conversations")
      .select(`
        id,
        contact_phone,
        lead_id,
        lead:leads!lead_id(
          id,
          name,
          stage_id,
          stage:pipeline_stages!stage_id(id, name, pipeline_id)
        )
      `)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(20);

    if (error) throw error;

    const result = (data || []).map((row: any) => ({
      conversationId: row.id,
      contactPhone: row.contact_phone,
      leadId: row.lead_id || null,
      leadName: row.lead?.name || null,
      stageId: row.lead?.stage_id || null,
      stageName: row.lead?.stage?.name || null,
      pipelineId: row.lead?.stage?.pipeline_id || null,
    }));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
