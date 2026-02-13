import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

/**
 * AppGate — THE SINGLE gate for all private routes.
 *
 * Decision tree (deterministic, no loops):
 * 1. loading → show spinner (NEVER redirect)
 * 2. no user → redirect to /auth
 * 3. user + no orgId → allow ONLY /onboarding, block everything else
 * 4. user + orgId → allow app, block /onboarding
 */
export function AppGate() {
  const { user, loading, orgId, signOut, refreshProfile, needsOnboarding } = useAuth();
  const location = useLocation();
  const [stuckLoading, setStuckLoading] = useState(false);

  // Debug logging (dev only)
  useEffect(() => {
    const gateReason = loading
      ? 'loading'
      : !user
        ? 'signedOut → /auth'
        : !orgId && needsOnboarding
          ? 'noOrg → onboarding'
          : orgId
            ? 'hasOrg → app'
            : 'waitingForOrg';

    console.log('🚪 AppGate', {
      path: location.pathname,
      loading,
      user: !!user,
      orgId,
      needsOnboarding,
      decision: gateReason,
    });
  }, [loading, user, orgId, needsOnboarding, location.pathname]);

  // Stuck loading detection (6s)
  useEffect(() => {
    if (!loading) {
      setStuckLoading(false);
      return;
    }
    const timer = setTimeout(() => setStuckLoading(true), 6000);
    return () => clearTimeout(timer);
  }, [loading]);

  // ── 1. Loading ──
  if (loading) {
    if (stuckLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center max-w-md p-6 space-y-4">
            <p className="font-poppins text-foreground">Demorando mais que o normal…</p>
            <p className="text-sm text-muted-foreground">
              Isso pode acontecer na primeira vez ou após uma atualização.
            </p>
            <div className="flex gap-2 justify-center pt-2">
              <Button
                onClick={() => {
                  setStuckLoading(false);
                  refreshProfile();
                }}
                size="sm"
              >
                Tentar novamente
              </Button>
              <Button variant="outline" onClick={signOut} size="sm">
                Sair
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-2 font-poppins text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  // ── 2. Not logged in ──
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // ── 3. Logged in but no org → only allow /onboarding ──
  if (!orgId && needsOnboarding) {
    if (location.pathname !== '/onboarding') {
      return <Navigate to="/onboarding" replace />;
    }
    return <Outlet />;
  }

  // ── 4. Has org → block /onboarding, allow everything else ──
  if (orgId) {
    if (location.pathname === '/onboarding') {
      return <Navigate to="/dashboard" replace />;
    }
    return <Outlet />;
  }

  // ── 5. Edge case: user exists, no orgId yet, not needsOnboarding ──
  // This means bootstrap is still resolving or profile is missing.
  // Show a waiting state instead of redirecting.
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md p-6 space-y-4">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="font-poppins text-foreground">Configurando sua conta...</p>
        <p className="text-sm text-muted-foreground">
          Isso pode levar alguns segundos na primeira vez.
        </p>
        <div className="flex gap-2 justify-center pt-4">
          <Button onClick={refreshProfile} size="sm">
            Tentar novamente
          </Button>
          <Button variant="outline" onClick={signOut} size="sm">
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}