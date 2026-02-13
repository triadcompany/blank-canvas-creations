import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useUser } from '@clerk/clerk-react';
import { supabase, dynamicHeaders } from '@/integrations/supabase/client';

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
  onboarding_completed?: boolean;
}

interface UseClerkSupabaseReturn {
  profile: Profile | null;
  role: 'admin' | 'seller' | null;
  loading: boolean;
  error: Error | null;
  needsOnboarding: boolean;
  refreshProfile: () => Promise<void>;
}

/** Race a promise against a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

export function useClerkSupabase(): UseClerkSupabaseReturn {
  const { user, isLoaded } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<'admin' | 'seller' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const isCheckingRef = useRef(false);
  const refreshingRef = useRef(false);

  const checkProfile = useCallback(async (clerkUser: typeof user) => {
    if (!clerkUser || isCheckingRef.current) return null;

    isCheckingRef.current = true;
    setError(null);
    setNeedsOnboarding(false);

    try {
      const clerkUserId = clerkUser.id;
      // Set header immediately so any concurrent queries can use it
      dynamicHeaders['x-clerk-user-id'] = clerkUserId;
      const email = clerkUser.primaryEmailAddress?.emailAddress || '';
      const name = clerkUser.fullName || clerkUser.firstName || email.split('@')[0] || 'User';
      const avatarUrl = clerkUser.imageUrl || undefined;

      console.log('🔍 checkProfile: Checking profile for:', clerkUserId);

      const { data: existingProfile, error: fetchError } = await withTimeout(
        Promise.resolve(
          supabase
            .from('profiles')
            .select('*')
            .eq('clerk_user_id', clerkUserId)
            .maybeSingle()
        ),
        8000,
        'Profile fetch'
      );

      if (fetchError && !fetchError.message?.includes('No rows')) {
        console.error('❌ Error fetching profile:', fetchError);
        throw new Error(fetchError.message);
      }

      if (!existingProfile) {
        const metadata = clerkUser.unsafeMetadata as Record<string, any> | undefined;
        const invitedOrgId = metadata?.organization_id as string | undefined;
        const invitedRole = (metadata?.role as string) || 'seller';

        // Determine org ID: from invite metadata OR from existing org_members row
        let resolvedOrgId = invitedOrgId;
        let resolvedRole = invitedRole;

        if (!resolvedOrgId) {
          // Check if user has an org membership (created by sync-login / bootstrap)
          const { data: membership } = await supabase
            .from('org_members')
            .select('organization_id, role')
            .eq('clerk_user_id', clerkUserId)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle();

          if (membership?.organization_id) {
            console.log('🔗 Found org_members membership, auto-provisioning profile...');
            resolvedOrgId = membership.organization_id;
            resolvedRole = membership.role || 'admin';
          }
        }

        if (resolvedOrgId) {
          console.log('🎟️ Auto-provisioning profile for org:', resolvedOrgId);
          const { data: newProfile, error: insertError } = await supabase
            .from('profiles')
            .insert({
              clerk_user_id: clerkUserId,
              email,
              name,
              avatar_url: avatarUrl,
              organization_id: resolvedOrgId,
              onboarding_completed: true,
            })
            .select()
            .single();

          if (insertError) {
            console.error('❌ Profile auto-provision failed:', insertError);
            // Don't throw - fall through to onboarding
          } else {
            // Insert role - ignore conflict since unique is on (user_id, organization_id) not clerk_user_id
            const { error: roleErr } = await supabase
              .from('user_roles')
              .insert({
                clerk_user_id: clerkUserId,
                organization_id: resolvedOrgId,
                role: resolvedRole === 'admin' ? 'admin' : 'seller',
              });

            if (roleErr) {
              console.warn('⚠️ user_roles insert warning (non-fatal):', roleErr.message);
            }

            setProfile(newProfile as Profile);
            setRole(resolvedRole === 'admin' ? 'admin' : 'seller');
            return newProfile as Profile;
          }
        }

        console.log('📝 No profile found and no membership - needs onboarding');
        setNeedsOnboarding(true);
        setProfile(null);
        setRole(null);
        return null;
      }

      console.log('✅ Profile found:', existingProfile.id, 'onboarding_completed:', existingProfile.onboarding_completed);

      let finalProfile: Profile = existingProfile as Profile;

      const needsUpdate =
        existingProfile.email !== email ||
        existingProfile.name !== name ||
        existingProfile.avatar_url !== avatarUrl;

      if (needsUpdate) {
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

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('clerk_user_id', clerkUserId)
        .maybeSingle();

      if (roleData?.role) {
        setRole(roleData.role as 'admin' | 'seller');
      } else {
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
    if (!user || refreshingRef.current) {
      console.log('⏭️ refreshProfile: skipped (no user or already refreshing)');
      return;
    }
    refreshingRef.current = true;
    setLoading(true);
    try {
      await withTimeout(checkProfile(user), 8000, 'refreshProfile');
    } catch (err) {
      console.error('❌ refreshProfile error:', err);
      setError(err instanceof Error ? err : new Error('Refresh failed'));
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }, [user, checkProfile]);

  // Track user ID to avoid re-running on Clerk user object reference changes (e.g. window focus)
  const lastCheckedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;

    if (!user) {
      console.log('👤 useClerkSupabase: No user, clearing profile');
      setProfile(null);
      setRole(null);
      setLoading(false);
      setError(null);
      setNeedsOnboarding(false);
      lastCheckedUserIdRef.current = null;
      // Clear the global header
      delete dynamicHeaders['x-clerk-user-id'];
      return;
    }

    // Skip if we already checked this user
    if (lastCheckedUserIdRef.current === user.id) return;
    lastCheckedUserIdRef.current = user.id;

    // Set global header so PostgREST RLS functions can identify the user
    dynamicHeaders['x-clerk-user-id'] = user.id;

    setLoading(true);
    withTimeout(checkProfile(user), 8000, 'Initial profile check')
      .catch((err) => {
        console.error('❌ Initial profile check failed:', err);
        setError(err instanceof Error ? err : new Error('Initial check failed'));
      })
      .finally(() => {
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
