-- Create user invitations table to track pending invites
CREATE TABLE public.user_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role app_role NOT NULL DEFAULT 'seller',
  invited_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(organization_id, email)
);

-- Enable RLS
ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;

-- Create policies for user invitations
CREATE POLICY "Admins can manage organization invitations" 
ON public.user_invitations 
FOR ALL 
USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Add trigger for updated_at
CREATE TRIGGER update_user_invitations_updated_at
BEFORE UPDATE ON public.user_invitations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Update the invite function to create invitation records
CREATE OR REPLACE FUNCTION public.invite_user_to_organization(
  inviter_user_id uuid, 
  invite_email text, 
  invite_name text, 
  invite_role app_role DEFAULT 'seller'::app_role
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  org_id uuid;
  inviter_profile_id uuid;
  existing_user uuid;
  existing_invitation uuid;
  result json;
BEGIN
  -- Check if inviter is admin and get their profile info
  SELECT organization_id, id INTO org_id, inviter_profile_id
  FROM profiles 
  WHERE user_id = inviter_user_id AND role = 'admin';
  
  IF org_id IS NULL THEN
    RETURN json_build_object('error', 'Only admins can invite users');
  END IF;
  
  -- Check if user already exists in auth
  SELECT id INTO existing_user 
  FROM auth.users 
  WHERE email = invite_email;
  
  IF existing_user IS NOT NULL THEN
    RETURN json_build_object('error', 'User already exists');
  END IF;
  
  -- Check if invitation already exists
  SELECT id INTO existing_invitation
  FROM user_invitations
  WHERE organization_id = org_id AND email = invite_email;
  
  IF existing_invitation IS NOT NULL THEN
    RETURN json_build_object('error', 'Invitation already sent to this email');
  END IF;
  
  -- Create invitation record
  INSERT INTO user_invitations (
    organization_id,
    email,
    name,
    role,
    invited_by,
    status
  ) VALUES (
    org_id,
    invite_email,
    invite_name,
    invite_role,
    inviter_profile_id,
    'pending'
  );
  
  RETURN json_build_object(
    'success', true, 
    'message', 'Invitation created successfully',
    'organization_id', org_id
  );
END;
$function$;