import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  MessageSquare,
  Wifi,
  WifiOff,
  QrCode,
  Send,
  Loader2,
  CheckCircle,
  XCircle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

const SUPABASE_URL = "https://tapbwlmdvluqdgvixkxf.supabase.co";

interface Integration {
  id: string;
  organization_id: string;
  provider: string;
  instance_name: string;
  status: string;
  is_active: boolean;
  phone_number: string | null;
  qr_code_data: string | null;
  connected_at: string | null;
}

export function EvolutionIntegration() {
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [instanceName, setInstanceName] = useState("");
  const [instanceNameError, setInstanceNameError] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Olá! Esta é uma mensagem de teste do AutoLead. 🚀");
  const { profile, isAdmin } = useAuth();
  const { toast } = useToast();

  const fetchIntegration = useCallback(async () => {
    if (!profile?.organization_id) return;
    try {
      const { data, error } = await supabase
        .from("whatsapp_integrations")
        .select("*")
        .eq("organization_id", profile.organization_id)
        .maybeSingle();

      if (error && error.code !== "PGRST116") throw error;
      if (data) {
        setIntegration(data as any);
        setInstanceName(data.instance_name || "");
      }
    } catch {
      // No integration yet
    } finally {
      setLoading(false);
    }
  }, [profile?.organization_id]);

  useEffect(() => {
    fetchIntegration();
  }, [fetchIntegration]);

  // Poll for status when QR pending
  useEffect(() => {
    if (integration?.status !== "qr_pending") return;
    const interval = setInterval(async () => {
      await fetchIntegration();
    }, 5000);
    return () => clearInterval(interval);
  }, [integration?.status, fetchIntegration]);

  const validateInstanceName = (name: string): boolean => {
    if (!name.trim()) {
      setInstanceNameError("Nome da instância é obrigatório");
      return false;
    }
    if (!/^[a-z0-9_-]{3,40}$/.test(name)) {
      setInstanceNameError("Use apenas letras minúsculas, números, - e _ (3-40 caracteres)");
      return false;
    }
    setInstanceNameError("");
    return true;
  };

  const handleConnect = async () => {
    if (!validateInstanceName(instanceName)) return;

    setActionLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/evolution-create-instance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: profile?.organization_id,
          instance_name: instanceName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao criar instância");

      if (data.connected) {
        toast({ title: "WhatsApp conectado!", description: "Instância já estava conectada" });
      } else {
        toast({ title: "QR Code gerado!", description: "Escaneie o QR code para conectar" });
      }
      await fetchIntegration();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRefreshQR = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/evolution-get-qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: profile?.organization_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao buscar QR");

      if (data.connected) {
        toast({ title: "WhatsApp conectado!", description: "Seu WhatsApp já está vinculado" });
      }
      await fetchIntegration();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!integration) return;
    setActionLoading(true);
    try {
      await supabase
        .from("whatsapp_integrations")
        .update({
          status: "disconnected",
          is_active: false,
          qr_code_data: null,
          connected_at: null,
          phone_number: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);

      toast({ title: "Desconectado", description: "Integração WhatsApp desativada" });
      await fetchIntegration();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendTest = async () => {
    if (!testPhone.trim()) {
      toast({ title: "Erro", description: "Informe o número para teste", variant: "destructive" });
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/evolution-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: profile?.organization_id,
          to_e164: testPhone.replace(/\D/g, ""),
          message: testMessage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao enviar");

      toast({ title: "Mensagem enviada!", description: `Teste enviado para ${testPhone}` });
    } catch (err: any) {
      toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="card-gradient border-0">
        <CardContent className="p-6 flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  const isConnected = integration?.status === "connected";
  const isPending = integration?.status === "qr_pending";

  // Read-only for non-admins
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <Card className="card-gradient border-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-poppins">
              <MessageSquare className="h-5 w-5 text-primary" />
              WhatsApp (Evolution API)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription>
                Apenas administradores podem configurar o WhatsApp.
              </AlertDescription>
            </Alert>

            {/* Show status read-only */}
            <div className="flex items-center gap-3">
              {isConnected ? (
                <Badge className="bg-green-500/10 text-green-600 border-green-200 gap-1 px-3 py-1.5">
                  <Wifi className="h-3.5 w-3.5" />
                  Conectado
                </Badge>
              ) : isPending ? (
                <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-200 gap-1 px-3 py-1.5">
                  <QrCode className="h-3.5 w-3.5" />
                  Aguardando QR Code
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1 px-3 py-1.5">
                  <WifiOff className="h-3.5 w-3.5" />
                  Desconectado
                </Badge>
              )}
              {integration?.instance_name && (
                <span className="text-xs text-muted-foreground font-mono">
                  Instância: {integration.instance_name}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card className="card-gradient border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-poppins">
            <MessageSquare className="h-5 w-5 text-primary" />
            WhatsApp (Evolution API)
          </CardTitle>
          <CardDescription className="font-poppins">
            Conecte o WhatsApp da sua organização via QR code
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Connection Status */}
          <div className="flex items-center gap-3">
            {isConnected ? (
              <Badge className="bg-green-500/10 text-green-600 border-green-200 gap-1 px-3 py-1.5">
                <Wifi className="h-3.5 w-3.5" />
                Conectado
              </Badge>
            ) : isPending ? (
              <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-200 gap-1 px-3 py-1.5">
                <QrCode className="h-3.5 w-3.5" />
                Aguardando QR Code
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 px-3 py-1.5">
                <WifiOff className="h-3.5 w-3.5" />
                Desconectado
              </Badge>
            )}
            {integration?.instance_name && (
              <span className="text-xs text-muted-foreground font-mono">
                Instância: {integration.instance_name}
              </span>
            )}
            {integration?.phone_number && (
              <span className="text-xs text-muted-foreground font-mono">
                Tel: {integration.phone_number}
              </span>
            )}
          </div>

          <Separator />

          {/* Setup Section - Show when not connected */}
          {!isConnected && !isPending && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="font-poppins font-medium">Nome da instância</Label>
                <Input
                  value={instanceName}
                  onChange={(e) => {
                    const val = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
                    setInstanceName(val);
                    if (val) validateInstanceName(val);
                  }}
                  placeholder="ex: minha-empresa ou org-vendas"
                  className="font-mono"
                  maxLength={40}
                />
                {instanceNameError && (
                  <p className="text-xs text-destructive">{instanceNameError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Identificador único, apenas minúsculas, números, - e _ (3-40 caracteres)
                </p>
              </div>
              <Button
                onClick={handleConnect}
                disabled={actionLoading || !instanceName.trim()}
                className="btn-gradient text-white font-poppins gap-2"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                Gerar QR e Conectar
              </Button>
            </div>
          )}

          {/* QR Code Section */}
          {isPending && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="font-poppins font-semibold mb-2">Escaneie o QR Code</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Abra o WhatsApp no celular → Menu (⋮) → Aparelhos conectados → Conectar
                </p>
                {integration?.qr_code_data ? (
                  <div className="inline-block p-4 bg-white rounded-xl shadow-md">
                    <img
                      src={integration.qr_code_data.startsWith("data:") ? integration.qr_code_data : `data:image/png;base64,${integration.qr_code_data}`}
                      alt="QR Code WhatsApp"
                      className="w-72 h-72 mx-auto"
                    />
                  </div>
                ) : (
                  <div className="inline-flex flex-col items-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Gerando QR code...</p>
                  </div>
                )}
              </div>
              <div className="flex justify-center gap-2">
                <Button variant="outline" onClick={handleRefreshQR} disabled={actionLoading} className="font-poppins gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Atualizar QR
                </Button>
              </div>
            </div>
          )}

          {/* Connected Section */}
          {isConnected && (
            <div className="space-y-6">
              <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-700 dark:text-green-400">
                  WhatsApp conectado e pronto para enviar mensagens das automações!
                  {integration?.connected_at && (
                    <span className="block text-xs mt-1 opacity-70">
                      Conectado em: {new Date(integration.connected_at).toLocaleString("pt-BR")}
                    </span>
                  )}
                </AlertDescription>
              </Alert>

              <Separator />

              {/* Test Message */}
              <div className="space-y-4">
                <h3 className="font-poppins font-semibold text-sm">Enviar mensagem de teste</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="font-poppins">Número (E.164, com DDD)</Label>
                    <Input
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="5511999999999"
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-poppins">Mensagem</Label>
                    <Input
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  onClick={handleSendTest}
                  disabled={actionLoading || !testPhone.trim()}
                  variant="outline"
                  className="font-poppins gap-2"
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Enviar Teste
                </Button>
              </div>

              <Separator />

              <div className="flex justify-end">
                <Button variant="destructive" size="sm" onClick={handleDisconnect} disabled={actionLoading} className="font-poppins gap-2">
                  <XCircle className="h-4 w-4" />
                  Desconectar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card className="card-gradient border-0">
        <CardHeader>
          <CardTitle className="font-poppins text-sm">Como funciona</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">1</div>
            <div>
              <p className="font-medium">Defina o nome da instância</p>
              <p className="text-muted-foreground">Um identificador único para sua organização (ex: minha-empresa)</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">2</div>
            <div>
              <p className="font-medium">Conecte via QR Code</p>
              <p className="text-muted-foreground">Escaneie com o WhatsApp do celular para vincular</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">3</div>
            <div>
              <p className="font-medium">Automações prontas</p>
              <p className="text-muted-foreground">As mensagens das automações serão enviadas automaticamente pelo WhatsApp conectado</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
