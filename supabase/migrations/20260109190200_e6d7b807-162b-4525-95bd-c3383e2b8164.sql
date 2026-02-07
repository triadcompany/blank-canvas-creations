-- Function to insert default lead sources for new organizations
CREATE OR REPLACE FUNCTION public.insert_default_lead_sources()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert default lead sources for the new organization
  INSERT INTO public.lead_sources (name, organization_id, created_by, is_active)
  VALUES 
    ('Indicação', NEW.id, NEW.owner_id, true),
    ('Loja', NEW.id, NEW.owner_id, true),
    ('Meta Ads', NEW.id, NEW.owner_id, true),
    ('Site', NEW.id, NEW.owner_id, true);
  
  RETURN NEW;
END;
$$;

-- Create trigger to run after organization is created
DROP TRIGGER IF EXISTS trigger_insert_default_lead_sources ON public.organizations;

CREATE TRIGGER trigger_insert_default_lead_sources
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.insert_default_lead_sources();