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

    // Determine bucket based on lead source
    const leadSourceLower = (normalizedLead.source || "").toLowerCase();
    const isTraffic = leadSourceLower.includes("meta") || leadSourceLower.includes("ads") || leadSourceLower.includes("google") || leadSourceLower.includes("tráfego");
    const bucket = isTraffic ? "traffic" : "non_traffic";

    // Apply dual-bucket distribution
    let finalSellerId = fallbackSellerId;
    const distributionResult = await applyDualBucketDistribution(supabase, organizationId, lead.id, bucket);

    if (distributionResult) {
      finalSellerId = distributionResult;
      // Update the lead with the correct seller
      await supabase
        .from("leads")
        .update({ seller_id: finalSellerId, assigned_to: finalSellerId })
        .eq("id", lead.id);

      // Update open opportunities too
      await supabase
        .from("opportunities")
        .update({ assigned_to: finalSellerId })
        .eq("lead_id", lead.id)
        .eq("status", "open");

      console.log(`Distribution result: assigned to ${finalSellerId} (bucket=${bucket})`);
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
        distribution: { bucket, assigned_to: finalSellerId }
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

// ── Dual-bucket distribution helper ──
async function applyDualBucketDistribution(
  supabase: any,
  orgId: string,
  leadId: string,
  bucket: string,
): Promise<string | null> {
  try {
    // Check global routing enabled
    const { data: globalSettings } = await supabase
      .from("whatsapp_routing_settings")
      .select("enabled")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!globalSettings?.enabled) return null;

    // Check bucket settings
    const { data: bucketSettings } = await supabase
      .from("whatsapp_routing_bucket_settings")
      .select("*")
      .eq("organization_id", orgId)
      .eq("bucket", bucket)
      .maybeSingle();

    if (!bucketSettings?.enabled) return null;

    let assignedUserId: string | null = null;

    if (bucketSettings.mode === "fixed_user") {
      assignedUserId = bucketSettings.fixed_user_id;
    } else if (bucketSettings.mode === "auto") {
      const userIds: string[] = bucketSettings.auto_assign_user_ids || [];
      if (userIds.length === 0) return null;

      const { data: routingState } = await supabase
        .from("whatsapp_routing_state")
        .select("id, last_assigned_user_id")
        .eq("organization_id", orgId)
        .eq("bucket", bucket)
        .maybeSingle();

      let nextIndex = 0;
      if (routingState?.last_assigned_user_id) {
        const lastIdx = userIds.indexOf(routingState.last_assigned_user_id);
        nextIndex = (lastIdx + 1) % userIds.length;
      }

      assignedUserId = userIds[nextIndex];

      if (routingState) {
        await supabase
          .from("whatsapp_routing_state")
          .update({ last_assigned_user_id: assignedUserId, updated_at: new Date().toISOString() })
          .eq("id", routingState.id);
      } else {
        await supabase
          .from("whatsapp_routing_state")
          .insert({ organization_id: orgId, bucket, last_assigned_user_id: assignedUserId });
      }
    }

    if (!assignedUserId) return null;

    // Resolve user_id → profile.id
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", assignedUserId)
      .eq("organization_id", orgId)
      .maybeSingle();

    return profile?.id || null;
  } catch (err) {
    console.error("[receive-lead-webhook] Distribution error:", err);
    return null;
  }
}
