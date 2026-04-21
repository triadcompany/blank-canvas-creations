import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useUser } from '@clerk/clerk-react';

const SUPABASE_URL = "https://tapbwlmdvluqdgvixkxf.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhcGJ3bG1kdmx1cWRndml4a3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2MDY0NDgsImV4cCI6MjA3MDE4MjQ0OH0.U2p9jneQ6Lcgu672Z8W-KnKhLgMLygDk1jB4a0YIwvQ";

/** Race a promise against a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

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
  /** Update the active org in memory after the user switches organizations.
   *  Avoids a full page reload while keeping AuthContext.orgId in sync. */
  setActiveOrg: (next: OrgInfo) => void;
}

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

      // Pull pending invitation token saved during /invite → /auth handoff.
      // This guarantees auto-accept even if Clerk email casing differs from invitation email.
      let invitationToken: string | undefined;
      try {
        invitationToken = sessionStorage.getItem('pending_invitation_token') || undefined;
      } catch {
        /* sessionStorage unavailable */
      }

      console.log('🔄 useAuthBootstrap: syncing login for', clerkUserId, invitationToken ? '(with invitation token)' : '');

      const syncResult = await withTimeout(
        callEdgeFunction('sync-login', {
          clerk_user_id: clerkUserId,
          email,
          full_name: fullName,
          avatar_url: avatarUrl,
          invitation_token: invitationToken,
        }),
        8000,
        'sync-login'
      );

      if (syncResult.membership) {
        console.log('✅ User has existing org membership');
        // Token consumed successfully — clear it so it doesn't leak into future sessions.
        try {
          sessionStorage.removeItem('pending_invitation_token');
        } catch {
          /* noop */
        }
        setOrg({
          org_id: syncResult.membership.organization_id,
          clerk_org_id: syncResult.membership.clerk_org_id,
          role: syncResult.membership.role as 'admin' | 'seller',
        });
        setNeedsOnboarding(false);
        return;
      }

      console.log('📝 No org found, checking if we should auto-create...');

      const clerkMemberships = clerkUser.organizationMemberships;

      if (clerkMemberships && clerkMemberships.length > 0) {
        console.log('⏳ User has Clerk org, waiting for webhook sync...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        const recheck = await withTimeout(
          callEdgeFunction('sync-login', {
            clerk_user_id: clerkUserId,
            email,
            full_name: fullName,
            avatar_url: avatarUrl,
            invitation_token: invitationToken,
          }),
          8000,
          'sync-login recheck'
        );

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
    if (!user) return;
    setLoading(true);
    try {
      await withTimeout(bootstrap(user), 10000, 'retryBootstrap');
    } catch (err: any) {
      console.error('❌ retryBootstrap error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, bootstrap]);

  // Track user ID to avoid re-running on Clerk user object reference changes (e.g. window focus)
  const lastBootstrappedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;

    if (!user) {
      setOrg(null);
      setLoading(false);
      setError(null);
      setNeedsOnboarding(false);
      lastBootstrappedUserIdRef.current = null;
      return;
    }

    // Skip if we already bootstrapped this user — UNLESS there's a pending
    // invitation token (user clicked a new invite link while already logged in,
    // or signed in via "Já tenho conta" on the /invite page).
    let hasPendingInviteToken = false;
    try {
      hasPendingInviteToken = !!sessionStorage.getItem('pending_invitation_token');
    } catch {
      /* noop */
    }

    if (lastBootstrappedUserIdRef.current === user.id && !hasPendingInviteToken) return;
    lastBootstrappedUserIdRef.current = user.id;

    setLoading(true);
    withTimeout(bootstrap(user), 10000, 'bootstrap')
      .catch((err: any) => {
        console.error('❌ Bootstrap timeout/error:', err.message);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [user, isLoaded, bootstrap]);

  const setActiveOrg = useCallback((next: OrgInfo) => {
    setOrg(next);
    setNeedsOnboarding(false);
    setError(null);
  }, []);

  return useMemo(() => ({
    org,
    loading: !isLoaded || loading,
    error,
    needsOnboarding,
    retryBootstrap,
    setActiveOrg,
  }), [org, isLoaded, loading, error, needsOnboarding, retryBootstrap, setActiveOrg]);
}
