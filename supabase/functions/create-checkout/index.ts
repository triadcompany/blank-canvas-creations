import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-clerk-user-id, x-clerk-org-id",
};

// Price IDs from Stripe
const PRICE_IDS = {
  start_monthly: "price_1SyGDeFQkZEOO4k85yqZUumT",
  start_yearly: "price_1SyGENFQkZEOO4k8FS5MOt7p",
  scale_monthly: "price_1SyGFCFQkZEOO4k88UbxLyBt",
  scale_yearly: "price_1SyGFoFQkZEOO4k8d8BXMBzY",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CHECKOUT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    logStep("Stripe key verified");

    // Get Clerk user info from headers
    const clerkUserId = req.headers.get("x-clerk-user-id");
    const clerkOrgId = req.headers.get("x-clerk-org-id");
    
    if (!clerkUserId || !clerkOrgId) {
      throw new Error("Missing Clerk user or organization ID");
    }
    logStep("Clerk IDs received", { clerkUserId, clerkOrgId });

    // Parse request body
    const { plan, billingCycle, userEmail, userName } = await req.json();
    
    if (!plan || !billingCycle) {
      throw new Error("Missing plan or billingCycle in request body");
    }
    logStep("Request parsed", { plan, billingCycle });

    // Get the correct price ID
    const priceKey = `${plan}_${billingCycle}` as keyof typeof PRICE_IDS;
    const priceId = PRICE_IDS[priceKey];
    
    if (!priceId) {
      throw new Error(`Invalid plan/billing combination: ${priceKey}`);
    }
    logStep("Price ID resolved", { priceKey, priceId });

    // Initialize Stripe
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Check if customer already exists
    const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
    let customerId: string | undefined;
    
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Existing customer found", { customerId });
    } else {
      // Create new customer
      const newCustomer = await stripe.customers.create({
        email: userEmail,
        name: userName,
        metadata: {
          clerk_user_id: clerkUserId,
          clerk_organization_id: clerkOrgId,
        },
      });
      customerId = newCustomer.id;
      logStep("New customer created", { customerId });
    }

    // Create checkout session
    const origin = req.headers.get("origin") || "https://autolead.lovable.app";
    
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${origin}/settings?tab=billing&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/settings?tab=billing&canceled=true`,
      subscription_data: {
        metadata: {
          clerk_user_id: clerkUserId,
          clerk_organization_id: clerkOrgId,
          plan: plan,
          billing_cycle: billingCycle,
        },
      },
      metadata: {
        clerk_user_id: clerkUserId,
        clerk_organization_id: clerkOrgId,
        plan: plan,
        billing_cycle: billingCycle,
      },
    });

    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
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
