import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-clerk-user-id, x-clerk-org-id",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    // Get Clerk organization ID from headers
    const clerkOrgId = req.headers.get("x-clerk-org-id");
    
    if (!clerkOrgId) {
      logStep("No organization ID provided");
      return new Response(JSON.stringify({ 
        subscribed: false,
        plan: null,
        billing_cycle: null,
        status: null,
        current_period_end: null,
        cancel_at_period_end: false,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    logStep("Clerk org ID received", { clerkOrgId });

    // Initialize Supabase with service role
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Query subscriptions table
    const { data: subscription, error } = await supabaseClient
      .from("subscriptions")
      .select("*")
      .eq("clerk_organization_id", clerkOrgId)
      .eq("status", "active")
      .single();

    if (error && error.code !== "PGRST116") {
      logStep("Database error", { error: error.message });
      throw new Error(`Database error: ${error.message}`);
    }

    if (!subscription) {
      logStep("No active subscription found");
      return new Response(JSON.stringify({ 
        subscribed: false,
        plan: null,
        billing_cycle: null,
        status: null,
        current_period_end: null,
        cancel_at_period_end: false,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    logStep("Active subscription found", { 
      plan: subscription.plan,
      status: subscription.status,
      billing_cycle: subscription.billing_cycle 
    });

    return new Response(JSON.stringify({
      subscribed: true,
      plan: subscription.plan,
      billing_cycle: subscription.billing_cycle,
      status: subscription.status,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
      stripe_subscription_id: subscription.stripe_subscription_id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
