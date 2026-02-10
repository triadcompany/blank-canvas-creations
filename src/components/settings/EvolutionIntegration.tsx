import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  MessageSquare, Wifi, WifiOff, QrCode as QrCodeIcon, Send,
  Loader2, CheckCircle, XCircle, RefreshCw, ShieldAlert, Bug,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import QRCodeLib from "qrcode";

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

interface DebugInfo {
  instance_name: string;
  endpoint: string;
  http_status: number;
  response: Record<string, unknown>;
  timestamp: string;
}

// Component to render QR from text using qrcode lib
function QrFromText({ text }: { text: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && text) {
      QRCodeLib.toCanvas(canvasRef.current, text, { width: 288, margin: 2 }, (err) => {
        if (err) console.error("[QrFromText] Error generating QR:", err);
      });
    }
  }, [text]);

  return <canvas ref={canvasRef} className="mx-auto" />;
}

function QrRenderer({ qrData, qrFormat }: { qrData: string; qrFormat: string | null }) {
  if (qrFormat === "data_url") {
    return <img src={qrData} alt="QR Code" className="w-72 h-72 mx-auto" />;
  }
  if (qrFormat === "base64") {
    return <img src={`data:image/png;base64,${qrData}`} alt="QR Code" className="w-72 h-72 mx-auto" />;
  }
  if (qrFormat === "url") {
    return <img src={qrData} alt="QR Code" className="w-72 h-72 mx-auto" />;
  }
  if (qrFormat === "text") {
    return <QrFromText text={qrData} />;
  }
  // Fallback: try as image, then as text
  return (
    <img
      src={qrData.startsWith("data:") ? qrData : `data:image/png;base64,${qrData}`}
      alt="QR Code"
      className="w-72 h-72 mx-auto"
      onError={() => {
        console.error("[QrRenderer] Fallback image failed");
      }}
    />
  );
}

export function EvolutionIntegration() {
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [instanceName, setInstanceName] = useState("");
  const [instanceNameError, setInstanceNameError] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Olá! Esta é uma mensagem de teste do AutoLead. 🚀");
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [lastQrFormat, setLastQrFormat] = useState<string | null>(null);
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

  useEffect(() => { fetchIntegration(); }, [fetchIntegration]);

  // Poll when QR pending
  useEffect(() => {
    if (integration?.status !== "qr_pending") return;
    const interval = setInterval(() => fetchIntegration(), 5000);
    return () => clearInterval(interval);
  }, [integration?.status, fetchIntegration]);

  const validateInstanceName = (name: string): boolean => {
    if (!name.trim()) { setInstanceNameError("Nome da instância é obrigatório"); return false; }
    if (!/^[a-z0-9_-]{3,40}$/.test(name)) { setInstanceNameError("Use apenas letras minúsculas, números, - e _ (3-40 caracteres)"); return false; }
    setInstanceNameError(""); return true;
  };

  const sanitizeResponse = (data: Record<string, unknown>): Record<string, unknown> => {
    const sanitized = { ...data };
    // Remove any potential API keys from debug display
    delete sanitized.apikey;
    delete sanitized.api_key;
    delete sanitized.token;
    return sanitized;
  };

  const handleConnect = async () => {
    if (!validateInstanceName(instanceName)) return;
    setActionLoading(true);
    setDebugInfo(null);

    const endpoint = `${SUPABASE_URL}/functions/v1/evolution-create-instance`;

    try {
      console.log("[EvolutionIntegration] Connecting:", instanceName);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: profile?.organization_id, instance_name: instanceName }),
      });

      const data = await res.json();
      console.log("[EvolutionIntegration] Response:", { status: res.status, data });

      setDebugInfo({
        instance_name: instanceName,
        endpoint,
        http_status: res.status,
        response: sanitizeResponse(data),
        timestamp: new Date().toISOString(),
      });

      if (data.qr_format) setLastQrFormat(data.qr_format);

      if (data.status === "connected") {
        toast({ title: "WhatsApp conectado!", description: "Instância já estava conectada" });
      } else if (data.ok && data.qr_code_data) {
        toast({ title: "QR Code gerado!", description: "Escaneie o QR code para conectar" });
      } else {
        // No QR available
        toast({
          title: "QR não obtido",
          description: data.message || "Não foi possível obter o QR. Verifique logs.",
          variant: "destructive",
        });
      }

      await fetchIntegration();
    } catch (err: any) {
      console.error("[EvolutionIntegration] Connect error:", err);
      toast({ title: "Erro ao conectar", description: err.message, variant: "destructive" });
      setDebugInfo({
        instance_name: instanceName,
        endpoint,
        http_status: 0,
        response: { error: err.message },
        timestamp: new Date().toISOString(),
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRefreshQR = async () => {
    setActionLoading(true);
    const endpoint = `${SUPABASE_URL}/functions/v1/evolution-get-qr`;

    try {
      console.log("[EvolutionIntegration] Refreshing QR...");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: profile?.organization_id }),
      });

      const data = await res.json();
      console.log("[EvolutionIntegration] Refresh response:", { status: res.status, data });

      setDebugInfo({
        instance_name: integration?.instance_name || "",
        endpoint,
        http_status: res.status,
        response: sanitizeResponse(data),
        timestamp: new Date().toISOString(),
      });

      if (data.qr_format) setLastQrFormat(data.qr_format);

      if (data.status === "connected") {
        toast({ title: "WhatsApp conectado!", description: "Seu WhatsApp já está vinculado" });
      } else if (data.ok && data.qr_code_data) {
        toast({ title: "QR atualizado!", description: "Escaneie o QR code" });
      } else {
        toast({
          title: "QR não disponível",
          description: data.message || "Tente novamente em alguns segundos",
          variant: "destructive",
        });
      }

      await fetchIntegration();
    } catch (err: any) {
      console.error("[EvolutionIntegration] Refresh error:", err);
      toast({ title: "Erro ao buscar QR", description: err.message, variant: "destructive" });
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
        .update({ status: "disconnected", is_active: false, qr_code_data: null, connected_at: null, phone_number: null, updated_at: new Date().toISOString() })
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
    if (!testPhone.trim()) { toast({ title: "Erro", description: "Informe o número", variant: "destructive" }); return; }
    setActionLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/evolution-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: profile?.organization_id, to_e164: testPhone.replace(/\D/g, ""), message: testMessage }),
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

  // Determine QR format for rendering from DB data
  const getStoredQrFormat = (data: string | null): string | null => {
    if (!data) return null;
    if (data.startsWith("data:image")) return "data_url";
    if (data.startsWith("http://") || data.startsWith("https://")) return "url";
    if (/^[A-Za-z0-9+/=]{50,}$/.test(data.replace(/\s/g, ""))) return "base64";
    if (data.length > 10) return "text";
    return null;
  };

  // Non-admin read-only view
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
              <AlertDescription>Apenas administradores podem configurar o WhatsApp.</AlertDescription>
            </Alert>
            <div className="flex items-center gap-3">
              {isConnected ? (
                <Badge className="bg-green-500/10 text-green-600 border-green-200 gap-1 px-3 py-1.5"><Wifi className="h-3.5 w-3.5" />Conectado</Badge>
              ) : isPending ? (
                <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-200 gap-1 px-3 py-1.5"><QrCodeIcon className="h-3.5 w-3.5" />Aguardando QR</Badge>
              ) : (
                <Badge variant="secondary" className="gap-1 px-3 py-1.5"><WifiOff className="h-3.5 w-3.5" />Desconectado</Badge>
              )}
              {integration?.instance_name && (
                <span className="text-xs text-muted-foreground font-mono">Instância: {integration.instance_name}</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const qrFormat = lastQrFormat || getStoredQrFormat(integration?.qr_code_data ?? null);

  return (
    <div className="space-y-6">
      <Card className="card-gradient border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-poppins">
            <MessageSquare className="h-5 w-5 text-primary" />
            WhatsApp (Evolution API)
          </CardTitle>
          <CardDescription className="font-poppins">Conecte o WhatsApp da sua organização via QR code</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Status */}
          <div className="flex items-center gap-3">
            {isConnected ? (
              <Badge className="bg-green-500/10 text-green-600 border-green-200 gap-1 px-3 py-1.5"><Wifi className="h-3.5 w-3.5" />Conectado</Badge>
            ) : isPending ? (
              <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-200 gap-1 px-3 py-1.5"><QrCodeIcon className="h-3.5 w-3.5" />Aguardando QR</Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 px-3 py-1.5"><WifiOff className="h-3.5 w-3.5" />Desconectado</Badge>
            )}
            {integration?.instance_name && (
              <span className="text-xs text-muted-foreground font-mono">Instância: {integration.instance_name}</span>
            )}
            {integration?.phone_number && (
              <span className="text-xs text-muted-foreground font-mono">Tel: {integration.phone_number}</span>
            )}
          </div>

          <Separator />

          {/* Setup - disconnected */}
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
                {instanceNameError && <p className="text-xs text-destructive">{instanceNameError}</p>}
                <p className="text-xs text-muted-foreground">Identificador único, apenas minúsculas, números, - e _ (3-40 caracteres)</p>
              </div>
              <Button onClick={handleConnect} disabled={actionLoading || !instanceName.trim()} className="btn-gradient text-white font-poppins gap-2">
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                Gerar QR e Conectar
              </Button>
            </div>
          )}

          {/* QR Pending */}
          {isPending && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="font-poppins font-semibold mb-2">Escaneie o QR Code</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Abra o WhatsApp no celular → Menu (⋮) → Aparelhos conectados → Conectar
                </p>
                {integration?.qr_code_data ? (
                  <div className="inline-block p-4 bg-white rounded-xl shadow-md">
                    <QrRenderer qrData={integration.qr_code_data} qrFormat={qrFormat} />
                  </div>
                ) : (
                  <div className="inline-flex flex-col items-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">QR ainda não disponível...</p>
                    <p className="text-xs text-muted-foreground">Clique "Atualizar QR" abaixo</p>
                  </div>
                )}
              </div>
              <div className="flex justify-center gap-2">
                <Button variant="outline" onClick={handleRefreshQR} disabled={actionLoading} className="font-poppins gap-2">
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Atualizar QR
                </Button>
              </div>
            </div>
          )}

          {/* Connected */}
          {isConnected && (
            <div className="space-y-6">
              <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-700 dark:text-green-400">
                  WhatsApp conectado e pronto para enviar mensagens!
                  {integration?.connected_at && (
                    <span className="block text-xs mt-1 opacity-70">
                      Conectado em: {new Date(integration.connected_at).toLocaleString("pt-BR")}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
              <Separator />
              <div className="space-y-4">
                <h3 className="font-poppins font-semibold text-sm">Enviar mensagem de teste</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="font-poppins">Número (E.164, com DDD)</Label>
                    <Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="5511999999999" className="font-mono" />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-poppins">Mensagem</Label>
                    <Input value={testMessage} onChange={(e) => setTestMessage(e.target.value)} />
                  </div>
                </div>
                <Button onClick={handleSendTest} disabled={actionLoading || !testPhone.trim()} variant="outline" className="font-poppins gap-2">
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

          {/* Debug Panel (admin only) */}
          <Separator />
          <div>
            <Button variant="ghost" size="sm" onClick={() => setShowDebug(!showDebug)} className="font-mono text-xs gap-1 text-muted-foreground">
              <Bug className="h-3.5 w-3.5" />
              {showDebug ? "Ocultar Debug" : "Debug (admin)"}
            </Button>
            {showDebug && (
              <div className="mt-2 p-3 rounded-md bg-muted/50 border text-xs font-mono space-y-2 max-h-80 overflow-auto">
                {debugInfo ? (
                  <>
                    <div><span className="text-muted-foreground">Timestamp:</span> {debugInfo.timestamp}</div>
                    <div><span className="text-muted-foreground">Instance:</span> {debugInfo.instance_name}</div>
                    <div><span className="text-muted-foreground">Endpoint:</span> {debugInfo.endpoint}</div>
                    <div><span className="text-muted-foreground">HTTP Status:</span> {debugInfo.http_status}</div>
                    <div><span className="text-muted-foreground">QR Format:</span> {lastQrFormat || "N/A"}</div>
                    <div><span className="text-muted-foreground">QR in DB:</span> {integration?.qr_code_data ? `present (${integration.qr_code_data.length} chars)` : "null"}</div>
                    <Separator />
                    <div>
                      <span className="text-muted-foreground">Response:</span>
                      <pre className="mt-1 whitespace-pre-wrap break-all text-[10px]">
                        {JSON.stringify(debugInfo.response, null, 2)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">Nenhuma requisição feita ainda. Clique em "Gerar QR" ou "Atualizar QR".</p>
                )}
              </div>
            )}
          </div>
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
