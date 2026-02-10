import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LeadPayload {
  // Support both English and Portuguese field names
  name?: string;
  nome?: string;
  phone?: string;
  telefone?: string;
  email?: string;
  source?: string;
  origem?: string;
  interest?: string;
  Interest?: string;
  interesse?: string;
  observations?: string;
  observacoes?: string;
}

interface NormalizedLead {
  name: string;
  phone: string;
  email?: string;
  source?: string;
  interest?: string;
  observations?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get organization ID from query params
    const url = new URL(req.url);
    const organizationId = url.searchParams.get("org");

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: "Organization ID is required. Use ?org=your_org_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const payload: LeadPayload = await req.json();

    // Normalize fields - support both English and Portuguese
    const normalizedLead: NormalizedLead = {
      name: payload.name || payload.nome || "",
      phone: payload.phone || payload.telefone || "",
      email: payload.email || undefined,
      source: payload.source || payload.origem || "webhook",
      interest: payload.interest || payload.Interest || payload.interesse || undefined,
      observations: payload.observations || payload.observacoes || undefined,
    };

    // Validate required fields
    if (!normalizedLead.name || !normalizedLead.phone) {
      return new Response(
        JSON.stringify({ 
          error: "Missing required fields", 
          required: ["name/nome", "phone/telefone"],
          received: payload 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify organization exists
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", organizationId)
      .single();

    if (orgError || !org) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the first pipeline for this organization
    const { data: pipelines, error: pipelineError } = await supabase
      .from("pipelines")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .limit(1);

    if (pipelineError || !pipelines || pipelines.length === 0) {
      return new Response(
        JSON.stringify({ error: "No pipelines found for this organization" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pipelineId = pipelines[0].id;

    // Get the first stage of this pipeline
    const { data: stages, error: stagesError } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: true })
      .limit(1);

    if (stagesError || !stages || stages.length === 0) {
      return new Response(
        JSON.stringify({ error: "No pipeline stages found for this organization" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const firstStageId = stages[0].id;

    // Get a fallback seller for initial creation (will be redistributed after)
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .eq("organization_id", organizationId)
      .limit(1);

    if (!profiles || profiles.length === 0) {
      return new Response(
        JSON.stringify({ error: "No sellers available in this organization" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fallbackSellerId = profiles[0].id;

    // Create the lead first (with fallback seller)
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({
        name: normalizedLead.name,
        phone: normalizedLead.phone,
        email: normalizedLead.email || null,
        source: normalizedLead.source || "webhook",
        interest: normalizedLead.interest || null,
        observations: normalizedLead.observations || null,
        organization_id: organizationId,
        stage_id: firstStageId,
        seller_id: fallbackSellerId,
        created_by: fallbackSellerId,
      })
      .select()
      .single();

    if (leadError) {
      console.error("Error creating lead:", leadError);
      return new Response(
        JSON.stringify({ error: "Failed to create lead", details: leadError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Now call the lead distribution RPC with the created lead ID
    const { data: distributionResult, error: distributionError } = await supabase
      .rpc("distribute_lead", { 
        p_lead_id: lead.id,
        p_organization_id: organizationId 
      });

    let finalSellerId = fallbackSellerId;

    if (!distributionError && distributionResult) {
      // Distribution function returns a jsonb with assigned_user_id
      if (distributionResult.assigned_user_id) {
        finalSellerId = distributionResult.assigned_user_id;
        
        // Update the lead with the correct seller
        await supabase
          .from("leads")
          .update({ seller_id: finalSellerId })
          .eq("id", lead.id);
      }
      console.log("Distribution result:", distributionResult);
    } else if (distributionError) {
      console.warn("Distribution error (using fallback):", distributionError);
    }

    // Log the webhook reception
    console.log(`Lead created via webhook: ${lead.id} for org: ${organizationId}, assigned to seller: ${finalSellerId}`);

    // Fire automation trigger for lead_created
    try {
      const triggerRes = await fetch(`${supabaseUrl}/functions/v1/automation-trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          organization_id: organizationId,
          trigger_type: "lead_created",
          entity_type: "lead",
          entity_id: lead.id,
          context: {
            lead_name: lead.name,
            lead_phone: lead.phone,
            lead_email: lead.email,
            source: lead.source,
            stage_id: lead.stage_id,
          },
        }),
      });
      const triggerData = await triggerRes.json();
      console.log(`[receive-lead-webhook] Automation trigger result:`, triggerData);
    } catch (triggerErr) {
      console.error("[receive-lead-webhook] Failed to fire automation trigger:", triggerErr);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Lead created successfully",
        lead: {
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          seller_id: finalSellerId,
          stage_id: lead.stage_id
        },
        distribution: distributionResult || null
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
