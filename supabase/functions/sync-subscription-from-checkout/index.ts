import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-clerk-user-id, x-clerk-org-id",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SYNC-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { session_id } = await req.json();
    
    if (!session_id) {
      logStep("No session_id provided");
      return new Response(JSON.stringify({ 
        success: false,
        error: "session_id is required" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    
    logStep("Session ID received", { session_id: session_id.substring(0, 20) + "..." });

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Retrieve the checkout session with subscription expanded
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription']
    });
    
    logStep("Checkout session retrieved", { 
      sessionId: session.id,
      status: session.status,
      paymentStatus: session.payment_status,
      hasSubscription: !!session.subscription
    });

    if (session.status !== 'complete') {
      logStep("Session not complete", { status: session.status });
      return new Response(JSON.stringify({ 
        success: false,
        error: "Checkout session is not complete" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Extract metadata
    const clerkOrgId = session.metadata?.clerk_organization_id;
    const clerkUserId = session.metadata?.clerk_user_id;
    const plan = session.metadata?.plan;
    const billingCycle = session.metadata?.billing_cycle;

    if (!clerkOrgId || !clerkUserId || !plan || !billingCycle) {
      logStep("Missing metadata", { metadata: session.metadata });
      return new Response(JSON.stringify({ 
        success: false,
        error: "Missing required metadata in checkout session" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    logStep("Metadata extracted", { clerkOrgId, clerkUserId, plan, billingCycle });

    // Get subscription details
    const subscription = session.subscription as Stripe.Subscription;
    
    if (!subscription) {
      logStep("No subscription found in session");
      return new Response(JSON.stringify({ 
        success: false,
        error: "No subscription found in checkout session" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    logStep("Subscription details", {
      subscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString()
    });

    // Initialize Supabase with service role
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Upsert subscription record
    const { error: upsertError } = await supabaseClient
      .from("subscriptions")
      .upsert({
        clerk_organization_id: clerkOrgId,
        clerk_user_id: clerkUserId,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: subscription.id,
        plan: plan,
        billing_cycle: billingCycle === "yearly" ? "yearly" : "monthly",
        status: "active",
        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "stripe_subscription_id",
      });

    if (upsertError) {
      logStep("Error upserting subscription", { error: upsertError });
      return new Response(JSON.stringify({ 
        success: false,
        error: `Database error: ${upsertError.message}` 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    logStep("Subscription synced successfully", { plan, billingCycle });

    return new Response(JSON.stringify({
      success: true,
      plan: plan,
      billing_cycle: billingCycle,
      status: "active",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
