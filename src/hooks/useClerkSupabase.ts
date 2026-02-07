import { useEffect, useState, useCallback, useRef } from 'react';
import { useUser, useSession } from '@clerk/clerk-react';
import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface Profile {
  id: string;
  user_id: string;
  clerk_user_id?: string;
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
 * Fetches the user's profile and role from Supabase based on their Clerk user ID.
 * If profile doesn't exist, calls Edge Function to create it.
 */
export function useClerkSupabase(): UseClerkSupabaseReturn {
  const { user, isLoaded } = useUser();
  const { session } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<'admin' | 'seller' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;
  const provisioningRef = useRef(false);

  const provisionUserViaEdgeFunction = useCallback(async () => {
    if (!session || provisioningRef.current) return null;
    
    provisioningRef.current = true;
    
    try {
      console.log('🆕 useClerkSupabase: Provisioning user via Edge Function:', user?.id);
      
      // Get a session token from Clerk
      const token = await session.getToken();
      
      if (!token) {
        throw new Error('Failed to get Clerk token');
      }

      // Use the official client to avoid browser/CORS edge cases
      const { data, error } = await supabase.functions.invoke('provision-clerk-user', {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : {}),
        },
      });

      if (error) {
        console.error('❌ Provision failed:', error);
        throw new Error(error.message || 'Failed to provision user');
      }

      console.log('✅ User provisioned:', data);
      setProfile(data.profile as Profile);
      setRole(data.role as 'admin' | 'seller');
      
      return data.profile;
    } catch (err) {
      console.error('❌ Error provisioning user:', err);
      throw err;
    } finally {
      provisioningRef.current = false;
    }
  }, [session, user?.id]);

  const fetchProfileAndRole = useCallback(async (clerkUserId: string) => {
    try {
      setLoading(true);
      setError(null);

      console.log('🔍 useClerkSupabase: Fetching profile for Clerk user:', clerkUserId);

      // Fetch profile by clerk_user_id
      const { data: profileData, error: profileError } = await (supabase
        .from('profiles')
        .select('*') as any)
        .eq('clerk_user_id', clerkUserId)
        .maybeSingle();

      if (profileError) {
        if (profileError.message?.includes('clerk_user_id')) {
          console.log('⏳ useClerkSupabase: clerk_user_id column not found, database migration needed');
          setLoading(false);
          return;
        }
        throw profileError;
      }

      if (!profileData) {
        retryCountRef.current += 1;
        
        if (retryCountRef.current >= maxRetries) {
          // After max retries, provision via Edge Function
          console.log('⚡ useClerkSupabase: Max retries reached, provisioning via Edge Function...');
          
          try {
            await provisionUserViaEdgeFunction();
            retryCountRef.current = 0;
          } catch (provisionError) {
            console.error('❌ Failed to provision user:', provisionError);
            setError(provisionError instanceof Error ? provisionError : new Error('Failed to provision user'));
          }
          setLoading(false);
          return;
        }
        
        console.log(`⏳ useClerkSupabase: Profile not found, retry ${retryCountRef.current}/${maxRetries}...`);
        setTimeout(() => fetchProfileAndRole(clerkUserId), 2000);
        return;
      }

      // Profile found - reset retry counter
      retryCountRef.current = 0;
      console.log('✅ useClerkSupabase: Profile fetched:', profileData);
      setProfile(profileData as unknown as Profile);

      // Fetch role by clerk_user_id
      const { data: roleData, error: roleError } = await (supabase
        .from('user_roles')
        .select('role') as any)
        .eq('clerk_user_id', clerkUserId)
        .maybeSingle();

      if (roleError) {
        if (roleError.message?.includes('clerk_user_id')) {
          console.log('⏳ useClerkSupabase: clerk_user_id column not found in user_roles');
          setRole(null);
        } else {
          console.error('❌ useClerkSupabase: Role fetch error:', roleError);
          setRole(null);
        }
      } else if (!roleData) {
        console.log('⏳ useClerkSupabase: Role not found, creating default admin role...');
        // Create admin role if missing - need organization_id from profile
        if (profileData?.organization_id) {
          const { error: createRoleError } = await supabase
            .from('user_roles')
            .insert({
              clerk_user_id: clerkUserId,
              user_id: clerkUserId,
              organization_id: profileData.organization_id,
              role: 'admin',
            } as any);
          
          if (!createRoleError) {
            setRole('admin');
          } else {
            console.error('❌ Error creating role:', createRoleError);
            setRole(null);
          }
        } else {
          setRole(null);
        }
      } else {
        console.log('✅ useClerkSupabase: Role fetched:', roleData?.role);
        setRole(roleData?.role as 'admin' | 'seller' || null);
      }

    } catch (err) {
      console.error('❌ useClerkSupabase: Error fetching profile:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [user, provisionUserViaEdgeFunction]);

  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      retryCountRef.current = 0;
      await fetchProfileAndRole(user.id);
    }
  }, [user, fetchProfileAndRole]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!user) {
      console.log('👤 useClerkSupabase: No user, clearing profile');
      setProfile(null);
      setRole(null);
      setLoading(false);
      retryCountRef.current = 0;
      return;
    }

    fetchProfileAndRole(user.id);
  }, [user, isLoaded, fetchProfileAndRole]);

  return {
    profile,
    role,
    loading: !isLoaded || loading,
    error,
    refreshProfile,
  };
}
