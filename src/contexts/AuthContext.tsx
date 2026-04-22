import React, { createContext, useContext, useCallback, useMemo } from 'react';
import { useUser, useAuth as useClerkAuth, useClerk, useOrganization } from '@clerk/clerk-react';
import { useClerkSupabase } from '@/hooks/useClerkSupabase';
import { useAuthBootstrap } from '@/hooks/useAuthBootstrap';
import { useClerkAvailable } from '@/providers/ClerkProvider';

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

// Tipo de usuário compatível com a interface anterior
interface CompatUser {
  id: string;
  email?: string;
}

interface AuthContextType {
  user: CompatUser | null;
  session: any | null;
  profile: Profile | null;
  role: 'admin' | 'seller' | null;
  error: Error | null;
  loading: boolean;
  needsOnboarding: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, name: string, organizationName?: string) => Promise<{ error: any; data?: any }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  retryBootstrap: () => Promise<void>;
  /** Update the active org in memory after switching organizations.
   *  Avoids a full page reload while keeping orgId / role / clerkOrgId in sync. */
  switchActiveOrg: (next: { org_id: string; clerk_org_id: string; role: 'admin' | 'seller' }) => void;
  isAdmin: boolean;
  orgId: string | null;
  clerkOrgId: string | null;
  /** User's display name from Clerk (fullName > firstName > email prefix) */
  userName: string;
  /** User's email from Clerk */
  userEmail: string;
  /** Organization name from Clerk (live) or Supabase (fallback) */
  orgName: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Internal provider that uses Clerk hooks - only rendered when Clerk is available
function AuthProviderWithClerk({ children }: { children: React.ReactNode }) {
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser();
  const { signOut: clerkSignOut } = useClerkAuth();
  const { openSignIn, openSignUp } = useClerk();
  const { organization: clerkOrganization } = useOrganization();
  const { profile, role, loading: supabaseLoading, refreshProfile, error, needsOnboarding } = useClerkSupabase();
  const { org, loading: bootstrapLoading, error: bootstrapError, needsOnboarding: bootstrapNeedsOnboarding, retryBootstrap, setActiveOrg } = useAuthBootstrap();

  // Converter usuário Clerk para formato compatível
  const user: CompatUser | null = clerkUser ? {
    id: clerkUser.id,
    email: clerkUser.primaryEmailAddress?.emailAddress,
  } : null;

  // Combined loading
  const loading = !clerkLoaded || supabaseLoading || bootstrapLoading;

  // Merge needsOnboarding from both hooks
  // If user has an org (from bootstrap), they don't need onboarding regardless of profile state
  const hasOrg = !!org;
  const profileOnboardingDone = profile && (profile as any).onboarding_completed === true;
  const combinedNeedsOnboarding = hasOrg || profileOnboardingDone ? false : (needsOnboarding || bootstrapNeedsOnboarding);

  // signIn agora abre o modal do Clerk
  const signIn = useCallback(async (_email: string, _password: string): Promise<{ error: any }> => {
    try {
      console.warn('signIn via AuthContext is deprecated. Use Clerk components instead.');
      openSignIn();
      return { error: null };
    } catch (error) {
      return { error };
    }
  }, [openSignIn]);

  // signUp agora abre o modal do Clerk
  const signUp = useCallback(async (_email: string, _password: string, _name: string, _organizationName?: string): Promise<{ error: any; data?: any }> => {
    try {
      console.warn('signUp via AuthContext is deprecated. Use Clerk components instead.');
      openSignUp();
      return { error: null, data: null };
    } catch (error) {
      return { error, data: null };
    }
  }, [openSignUp]);

  // signOut agora usa o Clerk
  const signOut = useCallback(async () => {
    await clerkSignOut();
  }, [clerkSignOut]);

  // SECURITY: derive isAdmin from a SINGLE source of truth (the active org
  // membership returned by sync-login) when available. Falling back to
  // user_roles only when bootstrap hasn't returned yet. Never use OR with
  // both sources — that allows privilege escalation when one of them is
  // stale (e.g. after switching organizations).
  const effectiveRole = org?.role ?? role;
  const isAdmin = effectiveRole === 'admin';

  const combinedError = error || (bootstrapError ? new Error(bootstrapError) : null);

  // Derive display name from Clerk (source of truth)
  const userName = clerkUser?.fullName
    || clerkUser?.firstName
    || clerkUser?.primaryEmailAddress?.emailAddress?.split('@')[0]
    || '';
  const userEmail = clerkUser?.primaryEmailAddress?.emailAddress || '';

  // Derive org name: prefer Clerk live data, fallback to profile's org
  const orgName = clerkOrganization?.name || '';

  const switchActiveOrg = useCallback(
    (next: { org_id: string; clerk_org_id: string; role: 'admin' | 'seller' }) => {
      setActiveOrg(next);
    },
    [setActiveOrg]
  );

  const value: AuthContextType = useMemo(() => ({
    user,
    session: clerkUser ? { user: clerkUser } : null,
    profile,
    role: org?.role || role,
    error: combinedError,
    loading,
    needsOnboarding: combinedNeedsOnboarding,
    signIn,
    signUp,
    signOut,
    refreshProfile,
    retryBootstrap,
    switchActiveOrg,
    isAdmin,
    orgId: org?.org_id || profile?.organization_id || null,
    clerkOrgId: org?.clerk_org_id || null,
    userName,
    userEmail,
    orgName,
  }), [user, clerkUser, profile, role, combinedError, loading, combinedNeedsOnboarding, signIn, signUp, signOut, refreshProfile, retryBootstrap, switchActiveOrg, isAdmin, org, userName, userEmail, orgName]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Fallback provider when Clerk is not available
function AuthProviderFallback({ children }: { children: React.ReactNode }) {
  const signIn = useCallback(async (_email: string, _password: string): Promise<{ error: any }> => {
    console.error('Clerk is not configured. Please add VITE_CLERK_PUBLISHABLE_KEY.');
    return { error: new Error('Clerk not configured') };
  }, []);

  const signUp = useCallback(async (_email: string, _password: string, _name: string, _organizationName?: string): Promise<{ error: any; data?: any }> => {
    console.error('Clerk is not configured. Please add VITE_CLERK_PUBLISHABLE_KEY.');
    return { error: new Error('Clerk not configured'), data: null };
  }, []);

  const signOut = useCallback(async () => {
    console.error('Clerk is not configured. Please add VITE_CLERK_PUBLISHABLE_KEY.');
  }, []);

  const refreshProfile = useCallback(async () => {}, []);

  const value: AuthContextType = useMemo(() => ({
    user: null,
    session: null,
    profile: null,
    role: null,
    error: null,
    loading: false,
    needsOnboarding: false,
    signIn,
    signUp,
    signOut,
    refreshProfile,
    retryBootstrap: refreshProfile,
    switchActiveOrg: () => {},
    isAdmin: false,
    orgId: null,
    clerkOrgId: null,
    userName: '',
    userEmail: '',
    orgName: '',
  }), [signIn, signUp, signOut, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const clerkAvailable = useClerkAvailable();

  if (!clerkAvailable) {
    console.warn('⚠️ Clerk is not available. Authentication will not work.');
    return <AuthProviderFallback>{children}</AuthProviderFallback>;
  }

  return <AuthProviderWithClerk>{children}</AuthProviderWithClerk>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
