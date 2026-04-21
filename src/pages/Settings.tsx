import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ReadOnlyBanner } from "@/components/auth/ReadOnlyBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSupabaseProfiles } from "@/hooks/useSupabaseProfiles";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useUserInvites } from "@/hooks/useUserInvites";
import { Link, useSearchParams } from "react-router-dom";
import { 
  Users, 
  Workflow, 
  Bell,
  Shield,
  User,
  Mail,
  UserPlus,
  Edit,
  Crown,
  UserCheck,
  Trash2,
  Clock,
  AlertCircle,
  Send,
  Copy,
  ExternalLink,
  MapPin,
  Play,
  Zap,
  Webhook,
  MessageSquare,
  PlayCircle,
  Instagram,
  CreditCard,
  ChevronDown,
  MailCheck,
  ToggleLeft,
  Inbox,
  Construction,
  Building2,
} from "lucide-react";
import { OrganizationSettings } from "@/components/settings/OrganizationSettings";
import { InstagramSettings } from "@/components/instagram/InstagramSettings";
import { UserProfile } from "@/components/settings/UserProfile";
import { EvolutionIntegration } from "@/components/settings/EvolutionIntegration";
import LeadDistribution from "@/components/settings/LeadDistribution";
import { LeadSourcesManagement } from "@/components/settings/LeadSourcesManagement";
import { TestLeadDistribution } from "@/components/settings/TestLeadDistribution";
import { N8nIntegration } from "@/components/settings/N8nIntegration";
import { WebhookIntegration } from "@/components/settings/WebhookIntegration";
import { FollowupTemplatesManagement } from "@/components/settings/FollowupTemplatesManagement";
import { FollowupCadencesManagement } from "@/components/settings/FollowupCadencesManagement";
import { ClerkMigration } from "@/components/settings/ClerkMigration";
import BillingSettings from "@/components/settings/BillingSettings";
import { MetaAdsSettings } from "@/components/settings/MetaAdsSettings";
import { DebugPanel } from "@/components/settings/DebugPanel";
import { useOrgSettings } from "@/hooks/useOrgSettings";
import { Switch } from "@/components/ui/switch";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Dialog,
  DialogContent, 
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function Settings() {
  const { profiles, invitations, updateProfile, deleteProfile, deleteInvitation, loading, refreshProfiles } = useSupabaseProfiles();
  const { profile, isAdmin } = useAuth();
  const { toast } = useToast();
  const { settings: orgSettings, updateInboxEnabled } = useOrgSettings();
  const { inviteUser, resendInvitation, revokeInvitation, loading: inviteLoading } = useUserInvites();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || "profile";
  const [activeTab, setActiveTabState] = useState(initialTab);

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    setSearchParams({ tab }, { replace: true });
  };

  // Sync from URL on mount/back-nav
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && tab !== activeTab) {
      setActiveTabState(tab);
    }
  }, [searchParams]);

  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "seller">("seller");
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleRoleUpdate = async (profileId: string, newRole: "admin" | "seller") => {
    await updateProfile(profileId, { role: newRole });
    setEditingProfile(null);
  };

  const isFollowupTab = activeTab === "templates" || activeTab === "cadences";
  const [followupOpen, setFollowupOpen] = useState(isFollowupTab);

  useEffect(() => {
    if (isFollowupTab) setFollowupOpen(true);
  }, [isFollowupTab]);

  type MenuItem = { id: string; icon: any; label: string; children?: MenuItem[] };

  const settingsItems: MenuItem[] = [
    { id: "billing", icon: CreditCard, label: "Planos e Cobrança" },
    { id: "profile", icon: User, label: "Meu Perfil" },
    ...(isAdmin ? [{ id: "organization", icon: Building2, label: "Organização" }] : []),
    { id: "vendors", icon: Users, label: "Usuários" },
    { id: "instagram", icon: Instagram, label: "Instagram" },
    { id: "whatsapp-evolution", icon: MessageSquare, label: "WhatsApp (Evolution)" },
    { id: "webhooks", icon: Webhook, label: "Webhooks" },
    { id: "distribution", icon: Users, label: "Distribuição de Leads" },
    { id: "sources", icon: MapPin, label: "Origens de Leads" },
    { id: "meta-ads", icon: Zap, label: "Meta Ads (CAPI)" },
    { id: "notifications", icon: Bell, label: "Notificações" },
    ...(isAdmin ? [{ id: "debug", icon: Shield, label: "Debug (Admin)" }] : []),
  ];

  const isReadonly = !isAdmin;

  const renderContent = () => {
    const content = (() => {
    switch (activeTab) {
      case "billing":
        return <BillingSettings />;
      case "profile":
        return <UserProfile />;
      case "organization":
        return <OrganizationSettings />;
      case "vendors":
        return renderVendorsContent();
      case "templates":
      case "templates":
        return <FollowupTemplatesManagement />;
      case "cadences":
        return <FollowupCadencesManagement />;
      case "whatsapp-evolution":
        return <EvolutionIntegration />;
      case "instagram":
        return <InstagramSettings />;
      case "webhooks":
        return (
          <div className="space-y-8">
            <WebhookIntegration />
            <Separator />
            <N8nIntegration />
          </div>
        );
      case "distribution":
        return (
          <div className="space-y-8">
            <LeadDistribution />
            <Separator />
            <TestLeadDistribution />
          </div>
        );
      case "sources":
        return <LeadSourcesManagement />;
      case "meta-ads":
        return <MetaAdsSettings />;
      case "debug":
        return <DebugPanel />;
      case "notifications":
        return (
          <Card className="card-gradient border-0">
            <CardContent className="p-8 text-center">
              <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground font-poppins">
                Configurações de notificações serão implementadas em breve.
              </p>
            </CardContent>
          </Card>
        );
      default:
        return <BillingSettings />;
    }
    })();

    if (isReadonly && activeTab !== "profile") {
      return (
        <div>
          <ReadOnlyBanner />
          <div className="pointer-events-none opacity-80 select-none">
            {content}
          </div>
        </div>
      );
    }

    return content;
  };

  const renderVendorsContent = () => {
    if (!isAdmin) {
      return (
        <Card className="card-gradient border-0">
          <CardContent className="p-8 text-center">
            <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-poppins font-bold text-foreground mb-2">
              Acesso Restrito
            </h2>
            <p className="text-muted-foreground font-poppins">
              Apenas administradores podem gerenciar usuários.
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-poppins font-semibold text-foreground">
              Gerenciar Usuários
            </h3>
            <p className="text-sm text-muted-foreground font-poppins">
              Adicione e gerencie vendedores e administradores do sistema
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="btn-gradient text-white font-poppins">
                <UserPlus className="h-4 w-4 mr-2" />
                Adicionar Usuário
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-poppins">Convidar Usuário</DialogTitle>
                <DialogDescription className="font-poppins">
                  O usuário receberá um email com um link para se cadastrar e entrar automaticamente nesta organização.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="userName" className="font-poppins">Nome (para identificação)</Label>
                  <Input
                    id="userName"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="Nome do usuário"
                    className="font-poppins"
                  />
                  <p className="text-xs text-muted-foreground font-poppins mt-1">
                    Usado apenas para identificar o convite. Não altera o nome da conta do usuário.
                  </p>
                </div>
                <div>
                  <Label htmlFor="userEmail" className="font-poppins">Email</Label>
                  <Input
                    id="userEmail"
                    type="email"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="email@empresa.com"
                    className="font-poppins"
                  />
                </div>
                <div>
                  <Label htmlFor="userRole" className="font-poppins">Função</Label>
                  <Select value={newUserRole} onValueChange={(value: "admin" | "seller") => setNewUserRole(value)}>
                    <SelectTrigger className="font-poppins">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="seller">Vendedor</SelectItem>
                      <SelectItem value="admin">Administrador</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setDialogOpen(false)} className="font-poppins">
                    Cancelar
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!newUserEmail || !newUserName) {
                        toast({
                          title: "Erro",
                          description: "Preencha todos os campos",
                          variant: "destructive",
                        });
                        return;
                      }

                      const submit = async (forceResend = false) => {
                        const result = await inviteUser({
                          email: newUserEmail,
                          name: newUserName,
                          role: newUserRole,
                          forceResend,
                        });

                        if (result.success) {
                          if (result.inviteUrl) {
                            try {
                              await navigator.clipboard.writeText(result.inviteUrl);
                              toast({
                                title: "✅ Link copiado",
                                description: "O link de convite foi copiado para sua área de transferência.",
                              });
                            } catch {
                              /* clipboard pode falhar em http; ignorar */
                            }
                          }
                          setNewUserEmail("");
                          setNewUserName("");
                          setNewUserRole("seller");
                          setDialogOpen(false);
                          refreshProfiles();
                          return;
                        }

                        // Tratamento dos erros estruturados
                        if (result.code === "ALREADY_MEMBER") {
                          toast({
                            title: "Usuário já é membro",
                            description: "Este email já pertence a um membro desta organização.",
                            variant: "destructive",
                          });
                          return;
                        }

                        if (result.code === "INVITE_PENDING") {
                          const ok = window.confirm(
                            "Já existe um convite pendente para este email. Deseja reenviar com um novo link?"
                          );
                          if (ok) {
                            await submit(true);
                          }
                          return;
                        }

                        toast({
                          title: "Erro ao enviar convite",
                          description: result.error || "Tente novamente.",
                          variant: "destructive",
                        });
                      };

                      await submit(false);
                    }}
                    className="btn-gradient text-white font-poppins"
                    disabled={inviteLoading}
                  >
                    {inviteLoading ? "Enviando..." : "Enviar Convite"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-4">
          {loading ? (
            <div className="text-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="mt-2 font-poppins text-muted-foreground text-sm">Carregando usuários...</p>
            </div>
          ) : (
            <>
              {profiles.map((userProfile) => (
                <Card key={userProfile.id} className="card-gradient border-0">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center flex-shrink-0">
                          {userProfile.avatar_url ? (
                            <img
                              src={userProfile.avatar_url}
                              alt={userProfile.name}
                              className="w-full h-full object-cover"
                            />
                          ) : userProfile.role === 'admin' ? (
                            <Crown className="h-5 w-5 text-primary" />
                          ) : (
                            <UserCheck className="h-5 w-5 text-primary" />
                          )}
                        </div>
                        <div>
                          <h4 className="font-poppins font-semibold text-foreground">
                            {userProfile.name}
                          </h4>
                          <div className="flex items-center space-x-2">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground font-poppins">
                              {userProfile.email}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge 
                          variant={userProfile.role === 'admin' ? 'default' : 'secondary'}
                          className="font-poppins"
                        >
                          {userProfile.role === 'admin' ? 'Administrador' : 'Vendedor'}
                        </Badge>
                        {editingProfile === userProfile.id ? (
                          <div className="flex items-center space-x-1">
                            <Select
                              value={userProfile.role}
                              onValueChange={(value: "admin" | "seller") => handleRoleUpdate(userProfile.id, value)}
                            >
                              <SelectTrigger className="w-32 h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="seller">Vendedor</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingProfile(userProfile.id)}
                              className="font-poppins"
                              disabled={userProfile.id === profile?.id}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            {userProfile.id !== profile?.id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteProfile(userProfile.id, userProfile.clerk_user_id || userProfile.user_id)}
                                className="font-poppins text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              
              {invitations.map((invitation) => {
                const isExpired =
                  invitation.expires_at && new Date(invitation.expires_at) < new Date();
                const isRevoked = invitation.status === "revoked";
                const isAccepted = invitation.status === "accepted";
                if (isAccepted) return null;

                return (
                  <Card
                    key={invitation.id}
                    className={`card-gradient border-0 border-l-4 ${
                      isRevoked
                        ? "border-l-muted-foreground"
                        : isExpired
                        ? "border-l-destructive"
                        : "border-l-orange-500"
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center space-x-3">
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center ${
                              isRevoked
                                ? "bg-muted"
                                : isExpired
                                ? "bg-destructive/10"
                                : "bg-orange-500/10"
                            }`}
                          >
                            <Clock
                              className={`h-5 w-5 ${
                                isRevoked
                                  ? "text-muted-foreground"
                                  : isExpired
                                  ? "text-destructive"
                                  : "text-orange-500"
                              }`}
                            />
                          </div>
                          <div>
                            <h4 className="font-poppins font-semibold text-foreground">
                              {invitation.name || invitation.email}
                            </h4>
                            <div className="flex items-center space-x-2">
                              <Mail className="h-3 w-3 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground font-poppins">
                                {invitation.email}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
                          {isRevoked ? (
                            <Badge variant="outline" className="font-poppins text-muted-foreground">
                              Revogado
                            </Badge>
                          ) : isExpired ? (
                            <Badge
                              variant="outline"
                              className="font-poppins text-destructive border-destructive/40"
                            >
                              Expirado
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="font-poppins text-orange-600 border-orange-200"
                            >
                              Aguardando
                            </Badge>
                          )}
                          <Badge
                            variant={invitation.role === "admin" ? "default" : "secondary"}
                            className="font-poppins"
                          >
                            {invitation.role === "admin" ? "Administrador" : "Vendedor"}
                          </Badge>
                          {!isRevoked && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={inviteLoading}
                              onClick={async () => {
                                const result = await resendInvitation(invitation.id);
                                if (result.success) {
                                  if (result.inviteUrl) {
                                    try {
                                      await navigator.clipboard.writeText(result.inviteUrl);
                                    } catch {
                                      /* noop */
                                    }
                                  }
                                  refreshProfiles();
                                }
                              }}
                              className="font-poppins"
                              title="Reenviar convite"
                            >
                              Reenviar
                            </Button>
                          )}
                          {!isRevoked && !isExpired && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={inviteLoading}
                              onClick={async () => {
                                if (!window.confirm("Revogar este convite? O link deixará de funcionar.")) return;
                                const result = await revokeInvitation(invitation.id);
                                if (result.success) refreshProfiles();
                              }}
                              className="font-poppins text-destructive hover:text-destructive"
                              title="Revogar convite"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                          {(isRevoked || isExpired) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteInvitation(invitation.id)}
                              className="font-poppins text-destructive hover:text-destructive"
                              title="Remover registro"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </div>
      </div>
    );
  };

  const renderPipelineContent = () => {
    return (
      <Card className="card-gradient border-0">
        <CardHeader>
          <CardTitle className="font-poppins font-semibold flex items-center space-x-2">
            <Workflow className="h-5 w-5 text-primary" />
            <span>Pipeline Personalizado</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground font-poppins">
              Personalize as etapas do seu funil de vendas
            </p>
            
            <div className="text-center py-8">
              <Workflow className="h-12 w-12 text-primary mx-auto mb-4" />
              <h4 className="text-lg font-poppins font-semibold mb-2">
                Gerenciamento de Pipeline
              </h4>
              <p className="text-muted-foreground font-poppins mb-4">
                Configure os estágios do funil de vendas da sua organização na página dedicada de pipelines.
              </p>
              <Button asChild className="btn-gradient text-white font-poppins">
                <Link to="/pipelines" className="flex items-center gap-2">
                  <Workflow className="h-4 w-4" />
                  Acessar Gerenciamento de Pipelines
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <PageHeader 
        title="Configurações" 
        description="Gerencie as configurações do seu CRM e personalize sua experiência"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar de configurações */}
        <div className="space-y-2">
          <Card className="card-gradient border-0">
            <CardContent className="p-4">
              <div className="space-y-1">
                {settingsItems.map((item) => {
                  if (item.children) {
                    return (
                      <div key={item.id}>
                        <button
                          onClick={() => setFollowupOpen(!followupOpen)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all duration-200 ${
                            isFollowupTab
                              ? "bg-primary/10 text-primary font-medium"
                              : "hover:bg-accent hover:text-accent-foreground"
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <item.icon className="h-4 w-4" />
                            <span className="font-poppins text-sm">{item.label}</span>
                          </div>
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${followupOpen ? "rotate-180" : ""}`} />
                        </button>
                        {followupOpen && (
                          <div className="ml-4 mt-1 space-y-1 border-l-2 border-border pl-3">
                            {item.children.map((child) => (
                              <button
                                key={child.id}
                                onClick={() => setActiveTab(child.id)}
                                className={`w-full flex items-center space-x-3 px-3 py-1.5 rounded-lg text-left transition-all duration-200 ${
                                  activeTab === child.id
                                    ? "bg-primary text-primary-foreground font-medium"
                                    : "hover:bg-accent hover:text-accent-foreground"
                                }`}
                              >
                                <child.icon className="h-3.5 w-3.5" />
                                <span className="font-poppins text-sm">{child.label}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-all duration-200 ${
                        activeTab === item.id
                          ? "bg-primary text-primary-foreground font-medium" 
                          : "hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="font-poppins text-sm">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Conteúdo principal */}
        <div className="col-span-2 space-y-6">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}