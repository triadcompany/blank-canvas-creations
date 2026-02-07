-- Fix public exposure of profiles, leads, and organizations tables
-- Add authentication requirement to all RLS policies

-- ==========================================
-- FIX 1: PROFILES TABLE - Require authentication
-- ==========================================

-- Drop existing permissive SELECT policies that don't enforce authentication
DROP POLICY IF EXISTS "Admins can view organization profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

-- Create new restrictive policies that require authentication
CREATE POLICY "Authenticated admins can view organization profiles" 
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL 
  AND has_role(auth.uid(), 'admin'::app_role) 
  AND organization_id = get_user_organization_id(auth.uid())
);

CREATE POLICY "Authenticated users can view their own profile" 
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL 
  AND user_id = auth.uid()
);

-- Update existing UPDATE and INSERT policies to ensure they're restrictive
DROP POLICY IF EXISTS "Admins can update organization profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert organization profiles" ON public.profiles;

CREATE POLICY "Authenticated admins can update organization profiles" 
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL 
  AND has_role(auth.uid(), 'admin'::app_role) 
  AND organization_id = get_user_organization_id(auth.uid())
);

CREATE POLICY "Authenticated users can update their own profile" 
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL 
  AND user_id = auth.uid()
);

CREATE POLICY "Authenticated admins can insert organization profiles" 
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL 
  AND has_role(auth.uid(), 'admin'::app_role) 
  AND organization_id = get_user_organization_id(auth.uid())
);

-- ==========================================
-- FIX 2: LEADS TABLE - Require authentication
-- ==========================================

-- Drop existing SELECT policies
DROP POLICY IF EXISTS "Users can view organization leads" ON public.leads;

-- Create new restrictive policy
CREATE POLICY "Authenticated users can view organization leads" 
ON public.leads
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL 
  AND organization_id = get_user_organization_id(auth.uid()) 
  AND (
    seller_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);

-- Update other policies to ensure authentication
DROP POLICY IF EXISTS "Users can create leads in their organization" ON public.leads;
DROP POLICY IF EXISTS "Users can update leads they have access to" ON public.leads;
DROP POLICY IF EXISTS "Admins can delete leads in their organization" ON public.leads;
DROP POLICY IF EXISTS "Admins can manage organization leads" ON public.leads;

CREATE POLICY "Authenticated users can create leads in their organization" 
ON public.leads
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL 
  AND organization_id = get_user_organization_id(auth.uid()) 
  AND seller_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) 
  AND created_by IN (SELECT id FROM profiles WHERE user_id = auth.uid())
);

CREATE POLICY "Authenticated users can update leads they have access to" 
ON public.leads
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL 
  AND can_user_update_lead(id, auth.uid())
);

CREATE POLICY "Authenticated admins can delete leads in their organization" 
ON public.leads
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL 
  AND organization_id = get_user_organization_id(auth.uid()) 
  AND has_role(auth.uid(), 'admin'::app_role)
);

-- ==========================================
-- FIX 3: ORGANIZATIONS TABLE - Require authentication
-- ==========================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
DROP POLICY IF EXISTS "Admins can update their organization" ON public.organizations;

-- Create new restrictive policies
CREATE POLICY "Authenticated users can view their own organization" 
ON public.organizations
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL 
  AND id = get_user_organization_id(auth.uid())
);

CREATE POLICY "Authenticated admins can update their organization" 
ON public.organizations
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL 
  AND id = get_user_organization_id(auth.uid()) 
  AND has_role(auth.uid(), 'admin'::app_role)
);