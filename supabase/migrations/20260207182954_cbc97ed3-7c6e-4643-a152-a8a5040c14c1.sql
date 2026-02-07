-- Create subscriptions table for Stripe billing
CREATE TABLE public.subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_organization_id TEXT NOT NULL,
  clerk_user_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT UNIQUE,
  plan TEXT NOT NULL CHECK (plan IN ('start', 'scale')),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'canceled', 'past_due', 'inactive', 'trialing')),
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create unique constraint for organization (one subscription per org)
CREATE UNIQUE INDEX idx_subscriptions_org ON public.subscriptions (clerk_organization_id) WHERE status = 'active';

-- Create index for faster lookups
CREATE INDEX idx_subscriptions_stripe_customer ON public.subscriptions (stripe_customer_id);
CREATE INDEX idx_subscriptions_stripe_sub ON public.subscriptions (stripe_subscription_id);
CREATE INDEX idx_subscriptions_status ON public.subscriptions (status);

-- Enable RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything (for webhooks)
CREATE POLICY "Service role has full access"
ON public.subscriptions
FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();