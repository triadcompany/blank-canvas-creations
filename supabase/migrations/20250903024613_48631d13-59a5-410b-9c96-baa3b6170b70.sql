-- Update the user creation trigger to create organization and set user as admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Create organization first
  INSERT INTO public.organizations (
    id,
    name,
    email,
    is_active
  ) VALUES (
    gen_random_uuid(),
    COALESCE(NEW.raw_user_meta_data ->> 'organization_name', 'Minha Empresa'),
    NEW.email,
    true
  );
  
  -- Get the organization ID we just created
  DECLARE
    org_id uuid;
  BEGIN
    SELECT id INTO org_id FROM public.organizations WHERE email = NEW.email ORDER BY created_at DESC LIMIT 1;
    
    -- Create user profile with admin role and organization
    INSERT INTO public.profiles (
      user_id, 
      name, 
      email, 
      role,
      organization_id
    ) VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data ->> 'name', NEW.email),
      NEW.email,
      'admin',
      org_id
    );
  END;
  
  RETURN NEW;
END;
$function$;

-- Create function to invite users (for future implementation)
CREATE OR REPLACE FUNCTION public.invite_user_to_organization(
  inviter_user_id uuid,
  invite_email text,
  invite_name text,
  invite_role app_role DEFAULT 'seller'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  org_id uuid;
  existing_user uuid;
  result json;
BEGIN
  -- Check if inviter is admin
  IF NOT EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = inviter_user_id AND role = 'admin'
  ) THEN
    RETURN json_build_object('error', 'Only admins can invite users');
  END IF;
  
  -- Get inviter's organization
  SELECT organization_id INTO org_id 
  FROM profiles 
  WHERE user_id = inviter_user_id;
  
  IF org_id IS NULL THEN
    RETURN json_build_object('error', 'No organization found');
  END IF;
  
  -- Check if user already exists
  SELECT id INTO existing_user 
  FROM auth.users 
  WHERE email = invite_email;
  
  IF existing_user IS NOT NULL THEN
    RETURN json_build_object('error', 'User already exists');
  END IF;
  
  -- For now, return success - actual email sending would be implemented via edge function
  RETURN json_build_object(
    'success', true, 
    'message', 'Invitation would be sent to ' || invite_email,
    'organization_id', org_id
  );
END;
$function$;