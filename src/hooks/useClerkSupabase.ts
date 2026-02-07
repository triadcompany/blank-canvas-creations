import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useUser } from '@clerk/clerk-react';
import { supabase } from '@/integrations/supabase/client';

interface Profile {
  id: string;
  user_id: string | null;
  clerk_user_id: string;
  name: string;
  email: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  avatar_url?: string;
  whatsapp_e164?: string;
}

interface UseClerkSupabaseReturn {
  profile: Profile | null;
  role: 'admin' | 'seller' | null;
  loading: boolean;
  error: Error | null;
  needsOnboarding: boolean;
  refreshProfile: () => Promise<void>;
}

/**
 * Hook to synchronize Clerk user with Supabase profile and roles.
 * Checks if profile exists - if not, sets needsOnboarding flag.
 * Organization creation happens in the Onboarding page.
 */
export function useClerkSupabase(): UseClerkSupabaseReturn {
  const { user, isLoaded } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<'admin' | 'seller' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const isCheckingRef = useRef(false);

  /**
   * Check if profile exists. If not, mark as needing onboarding.
   * If exists, update with latest Clerk data.
   */
  const checkProfile = useCallback(async (clerkUser: typeof user) => {
    if (!clerkUser || isCheckingRef.current) return null;
    
    isCheckingRef.current = true;
    setError(null);
    setNeedsOnboarding(false);

    try {
      const clerkUserId = clerkUser.id;
      const email = clerkUser.primaryEmailAddress?.emailAddress || '';
      const name = clerkUser.fullName || clerkUser.firstName || email.split('@')[0] || 'User';
      const avatarUrl = clerkUser.imageUrl || undefined;

      console.log('🔍 checkProfile: Checking profile for:', clerkUserId);

      // Try to find existing profile
      const { data: existingProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('clerk_user_id', clerkUserId)
        .maybeSingle();

      if (fetchError && !fetchError.message?.includes('No rows')) {
        console.error('❌ Error fetching profile:', fetchError);
        throw new Error(fetchError.message);
      }

      // If no profile exists, user needs onboarding
      if (!existingProfile) {
        console.log('📝 No profile found - needs onboarding');
        setNeedsOnboarding(true);
        setProfile(null);
        setRole(null);
        return null;
      }

      console.log('✅ Profile found:', existingProfile.id);
      
      let finalProfile: Profile = existingProfile as Profile;

      // Check if we need to update the profile with new Clerk data
      const needsUpdate = 
        existingProfile.email !== email ||
        existingProfile.name !== name ||
        existingProfile.avatar_url !== avatarUrl;

      if (needsUpdate) {
        console.log('🔄 Updating profile with new Clerk data...');
        const { data: updatedProfile, error: updateError } = await supabase
          .from('profiles')
          .update({
            email,
            name,
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('clerk_user_id', clerkUserId)
          .select()
          .single();

        if (!updateError && updatedProfile) {
          finalProfile = updatedProfile as Profile;
        }
      }

      setProfile(finalProfile);

      // Fetch role
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('clerk_user_id', clerkUserId)
        .maybeSingle();

      if (roleData?.role) {
        setRole(roleData.role as 'admin' | 'seller');
      } else {
        // Default to admin for profile owner
        setRole('admin');
      }

      return finalProfile;

    } catch (err) {
      console.error('❌ checkProfile error:', err);
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
      return null;
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      setLoading(true);
      await checkProfile(user);
      setLoading(false);
    }
  }, [user, checkProfile]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!user) {
      console.log('👤 useClerkSupabase: No user, clearing profile');
      setProfile(null);
      setRole(null);
      setLoading(false);
      setError(null);
      setNeedsOnboarding(false);
      return;
    }

    // Check profile exists
    setLoading(true);
    checkProfile(user).finally(() => {
      setLoading(false);
    });
  }, [user, isLoaded, checkProfile]);

  return useMemo(() => ({
    profile,
    role,
    loading: !isLoaded || loading,
    error,
    needsOnboarding,
    refreshProfile,
  }), [profile, role, isLoaded, loading, error, needsOnboarding, refreshProfile]);
}
