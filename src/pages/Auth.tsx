import { SignIn, SignUp } from '@clerk/clerk-react';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useClerkAvailable } from '@/providers/ClerkProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Building2, Mail, ShieldCheck, AlertTriangle, Sparkles, BarChart3, Users, Zap } from 'lucide-react';
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
    const signup = searchParams.get('signup');

    if (signup === 'true') {
      setIsSignUp(true);
    }

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

  // Clerk appearance customizada
  const clerkAppearance = {
    variables: {
      colorPrimary: 'hsl(24, 95%, 53%)',
      colorBackground: 'transparent',
      colorText: 'hsl(0, 0%, 22%)',
      colorInputBackground: 'hsl(0, 0%, 100%)',
      colorInputText: 'hsl(0, 0%, 22%)',
      borderRadius: '0.75rem',
      fontFamily: 'Poppins, sans-serif',
    },
    elements: {
      rootBox: 'w-full',
      card: 'bg-transparent shadow-none p-0 w-full',
      headerTitle: 'font-poppins font-bold text-2xl text-foreground',
      headerSubtitle: 'font-poppins text-muted-foreground text-sm',
      formButtonPrimary: 
        'bg-gradient-to-r from-primary to-orange-500 hover:from-primary/90 hover:to-orange-500/90 text-white font-poppins font-medium shadow-lg shadow-primary/25 transition-all duration-300 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 h-11',
      socialButtonsBlockButton: 'border border-border hover:bg-accent/50 font-poppins h-11 transition-all duration-200',
      socialButtonsBlockButtonText: 'font-poppins font-medium',
      formFieldLabel: 'font-poppins text-foreground font-medium text-sm',
      formFieldInput: 'font-poppins bg-white border-border text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary h-11 transition-all duration-200',
      footerActionLink: 'text-primary hover:text-primary/80 font-poppins font-medium',
      identityPreview: 'bg-muted/50 border-border',
      identityPreviewText: 'text-foreground',
      identityPreviewEditButton: 'text-primary hover:text-primary/80',
      dividerLine: 'bg-border',
      dividerText: 'text-muted-foreground font-poppins text-sm',
      formFieldInputShowPasswordButton: 'text-muted-foreground hover:text-foreground',
      alertText: 'text-destructive font-poppins',
      footer: 'hidden',
      formFieldRow: 'mb-4',
      form: 'gap-4',
    },
  };

  // Se Clerk não estiver disponível
  if (!clerkAvailable) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md animate-fade-in">
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

  const features = [
    { icon: BarChart3, title: 'Dashboard Inteligente', description: 'Visualize métricas em tempo real' },
    { icon: Users, title: 'Gestão de Leads', description: 'Pipeline de vendas completo' },
    { icon: Zap, title: 'Automação', description: 'Follow-ups automáticos' },
  ];

  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-br from-primary via-orange-500 to-orange-600 overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-96 h-96 bg-white rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-white rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
          <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-white rounded-full blur-2xl -translate-x-1/2 -translate-y-1/2" />
        </div>

        {/* Grid Pattern */}
        <div className="absolute inset-0 opacity-5">
          <div className="h-full w-full" style={{ 
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '50px 50px'
          }} />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 text-white w-full">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-primary-foreground/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <span className="text-2xl font-bold font-poppins">AutoLead</span>
          </div>

          {/* Main Content */}
          <div className="space-y-8">
            <div className="space-y-4">
              <h1 className="text-4xl xl:text-5xl font-bold font-poppins leading-tight">
                Transforme seus leads em clientes
              </h1>
              <p className="text-lg text-white/80 font-poppins max-w-md">
                A plataforma completa para gerenciar seu funil de vendas e aumentar suas conversões.
              </p>
            </div>

            {/* Features */}
            <div className="space-y-4">
              {features.map((feature, index) => (
                <div 
                  key={index}
                  className="flex items-center gap-4 p-4 bg-white/10 backdrop-blur-sm rounded-xl border border-white/10 transition-all duration-300 hover:bg-white/15"
                >
                  <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold font-poppins">{feature.title}</h3>
                    <p className="text-sm text-white/70 font-poppins">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="text-sm text-white/60 font-poppins">
            © 2024 AutoLead. Todos os direitos reservados.
          </div>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 bg-gradient-to-b from-background to-muted/30">
        <div className="w-full max-w-md space-y-8 animate-fade-in">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 bg-gradient-to-br from-primary to-accent rounded-xl flex items-center justify-center shadow-lg shadow-primary/25">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <span className="text-2xl font-bold font-poppins text-foreground">AutoLead</span>
          </div>

          {/* Header de convite */}
          {inviteData && (
            <div className="bg-card border border-border rounded-2xl p-6 space-y-4 shadow-lg animate-scale-in">
              <div className="flex items-center justify-center gap-2">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <UserPlus className="h-5 w-5 text-primary" />
                </div>
                <Badge variant="secondary" className="text-sm font-poppins font-medium">
                  Convite Recebido
                </Badge>
              </div>
              <h2 className="text-xl font-poppins font-bold text-center text-foreground">
                Bem-vindo(a) à equipe!
              </h2>
              <div className="bg-muted/50 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <div className="p-1.5 bg-background rounded-md">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="font-medium font-poppins text-foreground">{inviteData.orgName}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="p-1.5 bg-background rounded-md">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="capitalize font-poppins text-foreground">
                    {inviteData.role === 'admin' ? 'Administrador' : 'Vendedor'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="p-1.5 bg-background rounded-md">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-muted-foreground font-poppins">{inviteData.email}</span>
                </div>
              </div>
            </div>
          )}

          {/* Auth Header */}
          {!inviteData && (
            <div className="text-center space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold font-poppins text-foreground">
                {isSignUp ? 'Crie sua conta' : 'Bem-vindo de volta'}
              </h1>
              <p className="text-muted-foreground font-poppins">
                {isSignUp 
                  ? 'Comece a gerenciar seus leads hoje mesmo' 
                  : 'Entre para acessar seu painel de controle'}
              </p>
            </div>
          )}

          {/* Clerk Components */}
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-lg">
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
          </div>

          {/* Toggle entre login e cadastro */}
          {!inviteData && (
            <div className="text-center">
              <p className="text-sm text-muted-foreground font-poppins">
                {isSignUp ? 'Já tem uma conta?' : 'Ainda não tem conta?'}
                <Button
                  variant="link"
                  onClick={() => setIsSignUp(!isSignUp)}
                  className="font-poppins font-semibold text-primary hover:text-primary/80 px-1.5"
                >
                  {isSignUp ? 'Fazer login' : 'Criar conta'}
                </Button>
              </p>
            </div>
          )}

          {/* Mobile Footer */}
          <div className="lg:hidden text-center text-xs text-muted-foreground font-poppins pt-4">
            © 2024 AutoLead. Todos os direitos reservados.
          </div>
        </div>
      </div>
    </div>
  );
}
