import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useUser } from '@clerk/clerk-react';

const SUPABASE_URL = "https://tapbwlmdvluqdgvixkxf.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhcGJ3bG1kdmx1cWRndml4a3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2MDY0NDgsImV4cCI6MjA3MDE4MjQ0OH0.U2p9jneQ6Lcgu672Z8W-KnKhLgMLygDk1jB4a0YIwvQ";

interface OrgInfo {
  org_id: string;
  clerk_org_id: string;
  role: 'admin' | 'seller';
}

interface UseAuthBootstrapReturn {
  org: OrgInfo | null;
  loading: boolean;
  error: string | null;
  needsOnboarding: boolean;
  retryBootstrap: () => Promise<void>;
}

/**
 * Hook that bootstraps user on login:
 * 1. Syncs user profile to Supabase (sync-login)
 * 2. Checks for existing org membership
 * 3. If no org found, calls bootstrap-org to create one
 * 4. Returns resolved org info
 */
export function useAuthBootstrap(): UseAuthBootstrapReturn {
  const { user, isLoaded } = useUser();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const bootstrappingRef = useRef(false);

  const callEdgeFunction = useCallback(async (fnName: string, body: Record<string, any>) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `${fnName} failed with status ${res.status}`);
    }
    return data;
  }, []);

  const bootstrap = useCallback(async (clerkUser: NonNullable<typeof user>) => {
    if (bootstrappingRef.current) return;
    bootstrappingRef.current = true;
    setError(null);

    try {
      const clerkUserId = clerkUser.id;
      const email = clerkUser.primaryEmailAddress?.emailAddress || '';
      const fullName = clerkUser.fullName || clerkUser.firstName || email.split('@')[0] || 'User';
      const avatarUrl = clerkUser.imageUrl || undefined;

      console.log('🔄 useAuthBootstrap: syncing login for', clerkUserId);

      // Step 1: Sync login (upsert profile + get membership)
      const syncResult = await callEdgeFunction('sync-login', {
        clerk_user_id: clerkUserId,
        email,
        full_name: fullName,
        avatar_url: avatarUrl,
      });

      // Step 2: Check if membership already exists
      if (syncResult.membership) {
        console.log('✅ User has existing org membership');
        setOrg({
          org_id: syncResult.membership.organization_id,
          clerk_org_id: syncResult.membership.clerk_org_id,
          role: syncResult.membership.role as 'admin' | 'seller',
        });
        setNeedsOnboarding(false);
        return;
      }

      // Step 3: Check Clerk orgs (user might have been invited via Clerk)
      // If no membership in Supabase, try to bootstrap
      console.log('📝 No org found, checking if we should auto-create...');

      // Check Clerk organizationMemberships from user object
      const clerkMemberships = clerkUser.organizationMemberships;
      
      if (clerkMemberships && clerkMemberships.length > 0) {
        // User has Clerk org but not in Supabase yet — webhook should handle this
        // For now, wait a bit and re-check
        console.log('⏳ User has Clerk org, waiting for webhook sync...');
        // Give webhook a chance to fire
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Re-check
        const recheck = await callEdgeFunction('sync-login', {
          clerk_user_id: clerkUserId,
          email,
          full_name: fullName,
          avatar_url: avatarUrl,
        });

        if (recheck.membership) {
          setOrg({
            org_id: recheck.membership.organization_id,
            clerk_org_id: recheck.membership.clerk_org_id,
            role: recheck.membership.role as 'admin' | 'seller',
          });
          setNeedsOnboarding(false);
          return;
        }
      }

      // Step 4: No org anywhere — needs onboarding (will create via bootstrap-org)
      console.log('📝 No org found anywhere — marking needsOnboarding');
      setNeedsOnboarding(true);
      setOrg(null);

    } catch (err: any) {
      console.error('❌ useAuthBootstrap error:', err.message);
      setError(err.message);
    } finally {
      bootstrappingRef.current = false;
    }
  }, [callEdgeFunction]);

  const retryBootstrap = useCallback(async () => {
    if (user) {
      setLoading(true);
      await bootstrap(user);
      setLoading(false);
    }
  }, [user, bootstrap]);

  useEffect(() => {
    if (!isLoaded) return;

    if (!user) {
      setOrg(null);
      setLoading(false);
      setError(null);
      setNeedsOnboarding(false);
      return;
    }

    setLoading(true);
    bootstrap(user).finally(() => setLoading(false));
  }, [user, isLoaded, bootstrap]);

  return useMemo(() => ({
    org,
    loading: !isLoaded || loading,
    error,
    needsOnboarding,
    retryBootstrap,
  }), [org, isLoaded, loading, error, needsOnboarding, retryBootstrap]);
}
