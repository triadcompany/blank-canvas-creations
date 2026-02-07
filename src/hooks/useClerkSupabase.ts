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
  refreshProfile: () => Promise<void>;
}

/**
 * Hook to synchronize Clerk user with Supabase profile and roles.
 * Uses direct Supabase upsert - NO Edge Functions required.
 * Clerk is the source of truth for authentication.
 */
export function useClerkSupabase(): UseClerkSupabaseReturn {
  const { user, isLoaded } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<'admin' | 'seller' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const isProvisioningRef = useRef(false);

  /**
   * Ensure profile exists in Supabase.
   * Creates organization, profile, and role if they don't exist.
   * Updates profile data if it exists but has different info.
   */
  const ensureProfile = useCallback(async (clerkUser: typeof user) => {
    if (!clerkUser || isProvisioningRef.current) return null;
    
    isProvisioningRef.current = true;
    setError(null);

    try {
      const clerkUserId = clerkUser.id;
      const email = clerkUser.primaryEmailAddress?.emailAddress || '';
      const name = clerkUser.fullName || clerkUser.firstName || email.split('@')[0] || 'User';
      const avatarUrl = clerkUser.imageUrl || undefined;

      console.log('🔍 ensureProfile: Checking profile for:', clerkUserId);

      // 1. Try to find existing profile
      const { data: existingProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('clerk_user_id', clerkUserId)
        .maybeSingle();

      if (fetchError && !fetchError.message?.includes('No rows')) {
        console.error('❌ Error fetching profile:', fetchError);
        throw new Error(fetchError.message);
      }

      let finalProfile: Profile;

      if (existingProfile) {
        console.log('✅ Profile found:', existingProfile.id);
        
        // Check if we need to update the profile
        const needsUpdate = 
          existingProfile.email !== email ||
          existingProfile.name !== name ||
          existingProfile.avatar_url !== avatarUrl;

        if (needsUpdate) {
          console.log('🔄 Updating profile with new data...');
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

          if (updateError) {
            console.error('❌ Error updating profile:', updateError);
            // Don't throw - use existing profile
            finalProfile = existingProfile as Profile;
          } else {
            finalProfile = updatedProfile as Profile;
          }
        } else {
          finalProfile = existingProfile as Profile;
        }
      } else {
        // 2. Create new organization first
        console.log('🆕 Creating new organization and profile...');
        
        const { data: newOrg, error: orgError } = await supabase
          .from('organizations')
          .insert({ 
            name: `${name}'s Organization`,
            is_active: true,
          })
          .select('id')
          .single();

        if (orgError) {
          console.error('❌ Error creating organization:', orgError);
          throw new Error('Failed to create organization: ' + orgError.message);
        }

        console.log('✅ Organization created:', newOrg.id);

        // 3. Create profile
        const { data: newProfile, error: profileError } = await supabase
          .from('profiles')
          .insert({
            clerk_user_id: clerkUserId,
            email,
            name,
            avatar_url: avatarUrl,
            organization_id: newOrg.id,
          })
          .select()
          .single();

        if (profileError) {
          console.error('❌ Error creating profile:', profileError);
          // Try to rollback organization
          await supabase.from('organizations').delete().eq('id', newOrg.id);
          throw new Error('Failed to create profile: ' + profileError.message);
        }

        console.log('✅ Profile created:', newProfile.id);
        finalProfile = newProfile as Profile;

        // 4. Create admin role for new user
        const { error: roleError } = await supabase
          .from('user_roles')
          .insert({
            clerk_user_id: clerkUserId,
            organization_id: newOrg.id,
            role: 'admin',
          });

        if (roleError) {
          console.error('⚠️ Error creating role (non-blocking):', roleError);
          // Don't throw - profile was created, role is secondary
        } else {
          console.log('✅ Admin role created');
        }

        // 5. Create default pipeline for the organization
        try {
          const { data: pipeline } = await supabase
            .from('pipelines')
            .insert({
              name: 'Pipeline Principal',
              organization_id: newOrg.id,
              is_default: true,
            })
            .select('id')
            .single();

          if (pipeline) {
            const defaultStages = [
              { name: 'Novo Lead', position: 0, pipeline_id: pipeline.id, created_by: clerkUserId },
              { name: 'Contato Inicial', position: 1, pipeline_id: pipeline.id, created_by: clerkUserId },
              { name: 'Qualificação', position: 2, pipeline_id: pipeline.id, created_by: clerkUserId },
              { name: 'Proposta', position: 3, pipeline_id: pipeline.id, created_by: clerkUserId },
              { name: 'Negociação', position: 4, pipeline_id: pipeline.id, created_by: clerkUserId },
              { name: 'Fechamento', position: 5, pipeline_id: pipeline.id, created_by: clerkUserId },
              { name: 'Ganho', position: 6, pipeline_id: pipeline.id, created_by: clerkUserId },
              { name: 'Perdido', position: 7, pipeline_id: pipeline.id, created_by: clerkUserId },
            ];

            await supabase.from('pipeline_stages').insert(defaultStages);
            console.log('✅ Default pipeline created');
          }
        } catch (pipelineError) {
          console.log('⚠️ Pipeline creation skipped (non-blocking)');
        }
      }

      setProfile(finalProfile);

      // 5. Fetch role
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
      console.error('❌ ensureProfile error:', err);
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
      return null;
    } finally {
      isProvisioningRef.current = false;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      setLoading(true);
      await ensureProfile(user);
      setLoading(false);
    }
  }, [user, ensureProfile]);

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
      return;
    }

    // Ensure profile exists
    setLoading(true);
    ensureProfile(user).finally(() => {
      setLoading(false);
    });
  }, [user, isLoaded, ensureProfile]);

  return useMemo(() => ({
    profile,
    role,
    loading: !isLoaded || loading,
    error,
    refreshProfile,
  }), [profile, role, isLoaded, loading, error, refreshProfile]);
}
