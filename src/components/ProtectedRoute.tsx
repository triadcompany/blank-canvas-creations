import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

export function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, profile, role, loading, error, refreshProfile, signOut, needsOnboarding } = useAuth();
  const location = useLocation();

  // Show toast when error occurs (hook at top level)
  useEffect(() => {
    if (error && user && !profile && !needsOnboarding) {
      toast.error('Erro ao configurar conta', {
        description: 'Tente novamente em alguns segundos.',
        action: {
          label: 'Tentar novamente',
          onClick: refreshProfile,
        },
      });
    }
  }, [error, user, profile, needsOnboarding, refreshProfile]);

  // Aguardar carregar
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-2 font-poppins text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  // Se não está logado, redireciona para auth
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Se precisa de onboarding (primeira vez), redireciona
  if (needsOnboarding) {
    // Evita redirect loop se já está no onboarding
    if (location.pathname !== '/onboarding') {
      return <Navigate to="/onboarding" replace />;
    }
  }

  // Se profile ainda não existe e não é onboarding, mostrar loading com retry
  if (!profile && !needsOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md p-6 space-y-4">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="font-poppins text-foreground">Configurando sua conta...</p>
          <p className="text-sm text-muted-foreground">
            Isso pode levar alguns segundos na primeira vez.
          </p>
          {error && (
            <div className="space-y-2 pt-4">
              <p className="text-sm text-destructive">{error.message}</p>
              <div className="flex gap-2 justify-center">
                <Button onClick={refreshProfile} size="sm" className="font-poppins">
                  Tentar novamente
                </Button>
                <Button variant="outline" onClick={signOut} size="sm" className="font-poppins">
                  Sair
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Verificar permissão de admin
  if (adminOnly && role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
