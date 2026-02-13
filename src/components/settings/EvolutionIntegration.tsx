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

function QrFromText({ text }: { text: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current && text) {
      QRCodeLib.toCanvas(canvasRef.current, text, { width: 288, margin: 2 }, (err) => {
        if (err) console.error("[QrFromText] Error:", err);
      });
    }
  }, [text]);
  return <canvas ref={canvasRef} className="mx-auto" />;
}

function QrRenderer({ qrData, qrFormat }: { qrData: string; qrFormat: string | null }) {
  if (qrFormat === "data_url") return <img src={qrData} alt="QR Code" className="w-72 h-72 mx-auto" />;
  if (qrFormat === "base64") return <img src={`data:image/png;base64,${qrData}`} alt="QR Code" className="w-72 h-72 mx-auto" />;
  if (qrFormat === "url") return <img src={qrData} alt="QR Code" className="w-72 h-72 mx-auto" />;
  if (qrFormat === "text") return <QrFromText text={qrData} />;
  return (
    <img
      src={qrData.startsWith("data:") ? qrData : `data:image/png;base64,${qrData}`}
      alt="QR Code" className="w-72 h-72 mx-auto"
      onError={() => console.error("[QrRenderer] Fallback failed")}
    />
  );
}

function detectQrFormat(data: string | null): string | null {
  if (!data) return null;
  if (data.startsWith("data:image")) return "data_url";
  if (data.startsWith("http://") || data.startsWith("https://")) return "url";
  if (/^[A-Za-z0-9+/=]{50,}$/.test(data.replace(/\s/g, ""))) return "base64";
  if (data.length > 10) return "text";
  return null;
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
  const [polling, setPolling] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingCountRef = useRef(0);
  const { profile, isAdmin, orgId: authOrgId } = useAuth();
  const orgId = profile?.organization_id || authOrgId || '';
  const { toast } = useToast();

  const fetchIntegration = useCallback(async () => {
    if (!orgId) { setLoading(false); return null; }
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/evolution-get-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: orgId }),
      });
      const result = await res.json();
      if (result.ok && result.integration) {
        setIntegration(result.integration as Integration);
        setInstanceName(result.integration.instance_name || "");
        return result.integration as Integration;
      }
      return null;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  // Initial load
  useEffect(() => { fetchIntegration(); }, [fetchIntegration]);

  // Start polling for connection status (2s intervals, max 60s)
  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingCountRef.current = 0;
    setPolling(true);
    console.log("[EvolutionIntegration] Starting status polling...");

    pollingRef.current = setInterval(async () => {
      pollingCountRef.current++;
      console.log(`[EvolutionIntegration] Poll #${pollingCountRef.current}`);

      const result = await fetchIntegration();
      if (result?.status === "connected") {
        console.log("[EvolutionIntegration] Connected! Stopping poll.");
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setPolling(false);
        toast({ title: "WhatsApp conectado!", description: "Conexão estabelecida com sucesso." });
      } else if (pollingCountRef.current >= 30) {
        console.log("[EvolutionIntegration] Polling timeout (60s)");
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setPolling(false);
      }
    }, 2000);
  }, [fetchIntegration, toast]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const validateInstanceName = (name: string): boolean => {
    if (!name.trim()) { setInstanceNameError("Nome da instância é obrigatório"); return false; }
    if (!/^[a-z0-9_-]{3,40}$/.test(name)) { setInstanceNameError("Use apenas letras minúsculas, números, - e _ (3-40 caracteres)"); return false; }
    setInstanceNameError(""); return true;
  };

  const sanitizeResponse = (data: Record<string, unknown>): Record<string, unknown> => {
    const sanitized = { ...data };
    delete sanitized.apikey;
    delete sanitized.api_key;
    delete sanitized.token;
    return sanitized;
  };

  const handleConnect = async (existingInstanceName?: string) => {
    const nameToUse = existingInstanceName || instanceName;
    if (!validateInstanceName(nameToUse)) return;
    setActionLoading(true);
    setDebugInfo(null);

    const endpoint = `${SUPABASE_URL}/functions/v1/evolution-create-instance`;

    try {
      console.log("[EvolutionIntegration] Connecting:", nameToUse);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: orgId, instance_name: nameToUse }),
      });

      const data = await res.json();
      console.log("[EvolutionIntegration] Response:", { status: res.status, data });

      setDebugInfo({
        instance_name: nameToUse,
        endpoint,
        http_status: res.status,
        response: sanitizeResponse(data),
        timestamp: new Date().toISOString(),
      });

      if (data.qr_format) setLastQrFormat(data.qr_format);

      if (data.status === "connected") {
        setIntegration((prev) => ({
          ...(prev || { id: "", organization_id: orgId, provider: "evolution", instance_name: nameToUse, is_active: true, phone_number: null }),
          status: "connected",
          qr_code_data: null,
          connected_at: new Date().toISOString(),
          instance_name: nameToUse,
        } as Integration));
        toast({ title: "WhatsApp conectado!", description: "Instância já estava conectada" });
      } else if (data.ok && data.qr_code_data) {
        setIntegration((prev) => ({
          ...(prev || { id: "", organization_id: orgId, provider: "evolution", is_active: true, phone_number: null, connected_at: null }),
          status: "qr_pending",
          qr_code_data: data.qr_code_data,
          instance_name: nameToUse,
        } as Integration));
        toast({ title: "QR Code gerado!", description: "Escaneie o QR code para conectar" });
        // Start polling for connected status
        startPolling();
      } else {
        toast({
          title: "QR não obtido",
          description: data.message || "Não foi possível obter o QR. Verifique logs.",
          variant: "destructive",
        });
      }

      fetchIntegration();
    } catch (err: any) {
      console.error("[EvolutionIntegration] Connect error:", err);
      toast({ title: "Erro ao conectar", description: err.message, variant: "destructive" });
      setDebugInfo({ instance_name: nameToUse, endpoint, http_status: 0, response: { error: err.message }, timestamp: new Date().toISOString() });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRefreshQR = async () => {
    setActionLoading(true);
    const endpoint = `${SUPABASE_URL}/functions/v1/evolution-get-qr`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: orgId }),
      });

      const data = await res.json();
      console.log("[EvolutionIntegration] Refresh:", { status: res.status, data });

      setDebugInfo({ instance_name: integration?.instance_name || "", endpoint, http_status: res.status, response: sanitizeResponse(data), timestamp: new Date().toISOString() });

      if (data.qr_format) setLastQrFormat(data.qr_format);

      if (data.status === "connected") {
        setIntegration((prev) => prev ? { ...prev, status: "connected", qr_code_data: null } : prev);
        toast({ title: "WhatsApp conectado!", description: "Seu WhatsApp já está vinculado" });
      } else if (data.ok && data.qr_code_data) {
        setIntegration((prev) => prev ? { ...prev, status: "qr_pending", qr_code_data: data.qr_code_data } : prev);
        toast({ title: "QR atualizado!", description: "Escaneie o QR code" });
        startPolling();
      } else {
        toast({ title: "QR não disponível", description: data.message || "Tente novamente em alguns segundos", variant: "destructive" });
      }

      fetchIntegration();
    } catch (err: any) {
      toast({ title: "Erro ao buscar QR", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!integration) return;
    setActionLoading(true);
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; setPolling(false); }
    try {
      await supabase
        .from("whatsapp_integrations")
        .update({ status: "disconnected", is_active: false, qr_code_data: null, connected_at: null, phone_number: null, updated_at: new Date().toISOString() })
        .eq("id", integration.id);
      setIntegration((prev) => prev ? { ...prev, status: "disconnected", qr_code_data: null, connected_at: null, phone_number: null } : prev);
      toast({ title: "Desconectado", description: "Integração WhatsApp desativada" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReconnect = () => {
    if (integration?.instance_name) {
      handleConnect(integration.instance_name);
    }
  };

  const handleSendTest = async () => {
    if (!testPhone.trim()) { toast({ title: "Erro", description: "Informe o número", variant: "destructive" }); return; }
    setActionLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/evolution-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: orgId, to_e164: testPhone.replace(/\D/g, ""), message: testMessage }),
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
  const isDisconnected = !isConnected && !isPending;
  const hasExistingInstance = !!integration?.instance_name;

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
              <AlertDescription>Apenas administradores podem configurar o WhatsApp. Peça para um admin conectar.</AlertDescription>
            </Alert>
            <div className="flex items-center gap-3">
              <StatusBadge status={integration?.status} />
              {hasExistingInstance && (
                <span className="text-xs text-muted-foreground font-mono">Instância: {integration?.instance_name}</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const qrFormat = lastQrFormat || detectQrFormat(integration?.qr_code_data ?? null);

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
          {/* Status bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={integration?.status} />
            {hasExistingInstance && (
              <span className="text-xs text-muted-foreground font-mono">Instância: {integration?.instance_name}</span>
            )}
            {integration?.phone_number && (
              <span className="text-xs text-muted-foreground font-mono">Tel: {integration.phone_number}</span>
            )}
            {polling && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Aguardando conexão...
              </span>
            )}
          </div>

          <Separator />

          {/* ── CONNECTED STATE ── */}
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

              {/* Instance name (disabled) */}
              <div className="space-y-2">
                <Label className="font-poppins font-medium">Nome da instância</Label>
                <Input value={integration?.instance_name || ""} disabled className="font-mono bg-muted" />
              </div>

              <Separator />

              {/* Send test */}
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

              {/* Reconnect / Disconnect */}
              <div className="flex justify-between items-center">
                <Button variant="outline" size="sm" onClick={handleReconnect} disabled={actionLoading} className="font-poppins gap-2">
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Reconectar (Novo QR)
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDisconnect} disabled={actionLoading} className="font-poppins gap-2">
                  <XCircle className="h-4 w-4" />
                  Desconectar
                </Button>
              </div>
            </div>
          )}

          {/* ── QR PENDING STATE ── */}
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

          {/* ── DISCONNECTED STATE ── */}
          {isDisconnected && (
            <div className="space-y-4">
              {hasExistingInstance ? (
                <>
                  {/* Has existing instance — show reconnect flow */}
                  <Alert className="border-destructive/30 bg-destructive/5">
                    <WifiOff className="h-4 w-4 text-destructive" />
                    <AlertDescription className="text-destructive">
                      A sessão do WhatsApp foi desconectada. Clique abaixo para gerar um novo QR e reconectar usando a mesma instância.
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-2">
                    <Label className="font-poppins font-medium">Nome da instância</Label>
                    <Input value={integration?.instance_name || ""} disabled className="font-mono bg-muted" />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleReconnect} disabled={actionLoading} className="btn-gradient text-white font-poppins gap-2">
                      {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCodeIcon className="h-4 w-4" />}
                      Gerar QR novamente
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIntegration(null);
                        setInstanceName("");
                      }}
                      className="font-poppins text-muted-foreground"
                    >
                      Usar outra instância
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {/* No instance — new setup */}
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
                  <Button onClick={() => handleConnect()} disabled={actionLoading || !instanceName.trim()} className="btn-gradient text-white font-poppins gap-2">
                    {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                    Gerar QR e Conectar
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Debug Panel */}
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
                    <div><span className="text-muted-foreground">QR in state:</span> {integration?.qr_code_data ? `present (${integration.qr_code_data.length} chars)` : "null"}</div>
                    <div><span className="text-muted-foreground">Status:</span> {integration?.status || "none"}</div>
                    <div><span className="text-muted-foreground">Polling:</span> {polling ? `active (#${pollingCountRef.current})` : "off"}</div>
                    <Separator />
                    <div>
                      <span className="text-muted-foreground">Response:</span>
                      <pre className="mt-1 whitespace-pre-wrap break-all text-[10px]">
                        {JSON.stringify(debugInfo.response, null, 2)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">Nenhuma requisição feita ainda.</p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Instructions card */}
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

function StatusBadge({ status }: { status: string | undefined }) {
  if (status === "connected") {
    return <Badge className="bg-green-500/10 text-green-600 border-green-200 gap-1 px-3 py-1.5"><Wifi className="h-3.5 w-3.5" />Conectado</Badge>;
  }
  if (status === "qr_pending") {
    return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-200 gap-1 px-3 py-1.5"><QrCodeIcon className="h-3.5 w-3.5" />Aguardando QR</Badge>;
  }
  return <Badge variant="secondary" className="gap-1 px-3 py-1.5"><WifiOff className="h-3.5 w-3.5" />Desconectado</Badge>;
}
