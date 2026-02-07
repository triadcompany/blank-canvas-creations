
-- Drop and recreate the function with the correct logic
CREATE OR REPLACE FUNCTION public.insert_default_lead_sources()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  creator_profile_id uuid;
BEGIN
  -- Get the profile id of the user who created this organization (from the profiles table)
  SELECT id INTO creator_profile_id 
  FROM public.profiles 
  WHERE organization_id = NEW.id 
  LIMIT 1;
  
  -- Only insert if we found a profile (the profile is created before this trigger fires from handle_new_user)
  IF creator_profile_id IS NOT NULL THEN
    INSERT INTO public.lead_sources (name, organization_id, created_by, is_active)
    VALUES 
      ('Indicação', NEW.id, creator_profile_id, true),
      ('Loja', NEW.id, creator_profile_id, true),
      ('Meta Ads', NEW.id, creator_profile_id, true),
      ('Site', NEW.id, creator_profile_id, true);
  END IF;
  
  RETURN NEW;
END;
$$;
