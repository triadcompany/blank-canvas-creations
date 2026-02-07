import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

export function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, profile, role, loading, error, refreshProfile, signOut } = useAuth();

  // Aguardar carregar
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
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

  // Se profile ainda não existe (webhook pode estar processando), mostrar loading
  if (!profile) {
    if (error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="font-poppins">Não foi possível configurar sua conta</AlertTitle>
              <AlertDescription className="font-poppins">
                {error.message || 'Tente novamente em instantes.'}
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button onClick={refreshProfile} className="w-full font-poppins">Tentar novamente</Button>
              <Button variant="outline" onClick={signOut} className="w-full font-poppins">Sair</Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-2 font-poppins text-muted-foreground">Configurando conta...</p>
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
