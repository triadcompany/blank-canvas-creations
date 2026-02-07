import { SignIn, SignUp } from '@clerk/clerk-react';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useClerkAvailable } from '@/providers/ClerkProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Building2, Mail, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function Auth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const { user, loading } = useAuth();
  const clerkAvailable = useClerkAvailable();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Dados de convite
  const [inviteData, setInviteData] = useState<{
    email: string;
    name: string;
    role: string;
    orgId: string;
    orgName?: string;
  } | null>(null);

  // Redirect se já estiver logado
  useEffect(() => {
    if (!loading && user) {
      // Redireciona para dashboard - o profile será criado no ProtectedRoute
      navigate('/');
    }
  }, [loading, user, navigate]);

  // Verificar se é um convite aceito
  useEffect(() => {
    const invited = searchParams.get('invited');
    const inviteEmail = searchParams.get('email');
    const inviteName = searchParams.get('name');
    const inviteRole = searchParams.get('role');
    const orgId = searchParams.get('orgId');
    const orgName = searchParams.get('orgName');

    if (invited === 'true' && inviteEmail) {
      setIsSignUp(true);
      setInviteData({
        email: inviteEmail,
        name: inviteName || '',
        role: inviteRole || 'seller',
        orgId: orgId || '',
        orgName: orgName || 'Organização'
      });
    }
  }, [searchParams]);

  // Appearance customizada para combinar com o design system
  const clerkAppearance = {
    variables: {
      colorPrimary: 'hsl(250, 84%, 54%)',
      colorBackground: 'hsl(240, 10%, 3.9%)',
      colorText: 'hsl(0, 0%, 98%)',
      colorInputBackground: 'hsl(240, 3.7%, 15.9%)',
      colorInputText: 'hsl(0, 0%, 98%)',
      borderRadius: '0.75rem',
    },
    elements: {
      rootBox: 'w-full',
      card: 'bg-card/80 backdrop-blur-sm border border-border shadow-2xl w-full max-w-md',
      headerTitle: 'font-poppins font-bold text-foreground text-2xl',
      headerSubtitle: 'font-poppins text-muted-foreground',
      formButtonPrimary: 
        'bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground font-poppins shadow-lg',
      socialButtonsBlockButton: 'border-border hover:bg-accent font-poppins',
      formFieldLabel: 'font-poppins text-foreground',
      formFieldInput: 'font-poppins bg-input border-border text-foreground focus:ring-2 focus:ring-primary/50',
      footerActionLink: 'text-primary hover:text-primary/80 font-poppins',
      identityPreview: 'bg-muted border-border',
      identityPreviewText: 'text-foreground',
      identityPreviewEditButton: 'text-primary',
      dividerLine: 'bg-border',
      dividerText: 'text-muted-foreground font-poppins',
      formFieldInputShowPasswordButton: 'text-muted-foreground hover:text-foreground',
      alertText: 'text-destructive font-poppins',
      footer: 'hidden',
    },
  };

  // Se Clerk não estiver disponível, mostrar erro
  if (!clerkAvailable) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
        <div className="w-full max-w-md">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="font-poppins">Autenticação não configurada</AlertTitle>
            <AlertDescription className="font-poppins">
              A chave do Clerk (VITE_CLERK_PUBLISHABLE_KEY) não está configurada. 
              Entre em contato com o administrador do sistema.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header de convite */}
        {inviteData && (
          <div className="bg-card/80 backdrop-blur-sm border border-border rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-center gap-2">
              <UserPlus className="h-6 w-6 text-primary" />
              <Badge variant="secondary" className="text-sm font-poppins">
                Cadastro via Convite
              </Badge>
            </div>
            <h2 className="text-2xl font-poppins font-bold text-center">
              Bem-vindo(a)!
            </h2>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium font-poppins">{inviteData.orgName}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <span className="capitalize font-poppins">
                  {inviteData.role === 'admin' ? 'Administrador' : 'Vendedor'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground font-poppins">{inviteData.email}</span>
              </div>
            </div>
          </div>
        )}

        {/* Componentes do Clerk */}
        {isSignUp ? (
          <SignUp 
            appearance={clerkAppearance}
            routing="hash"
            signInUrl="/auth"
            forceRedirectUrl="/"
            unsafeMetadata={inviteData ? {
              organization_id: inviteData.orgId,
              role: inviteData.role,
              invited_name: inviteData.name,
            } : undefined}
          />
        ) : (
          <SignIn 
            appearance={clerkAppearance}
            routing="hash"
            signUpUrl="/auth?signup=true"
            forceRedirectUrl="/"
          />
        )}

        {/* Toggle entre login e cadastro */}
        {!inviteData && (
          <div className="text-center">
            <Button
              variant="link"
              onClick={() => setIsSignUp(!isSignUp)}
              className="font-poppins text-sm text-muted-foreground hover:text-primary"
            >
              {isSignUp ? 'Já tem conta? Fazer login' : 'Não tem conta? Cadastre-se'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
