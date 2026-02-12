import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Loader2, TestTube, ExternalLink, Info, Check, X,
  RefreshCw, Eye, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface CapiSettings {
  id: string;
  pixel_id: string;
  access_token: string;
  test_event_code: string | null;
  enabled: boolean;
  test_mode: boolean;
  domain: string | null;
}

interface QueueItem {
  id: string;
  organization_id: string;
  lead_id: string | null;
  event_name: string;
  channel: string;
  payload: any;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_retry_at: string | null;
  sent_at: string | null;
  event_hash: string;
  created_at: string;
}

interface CapiLog {
  id: string;
  lead_id: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
  meta_event: string;
  status: string;
  http_status: number | null;
  request_json: any;
  response_json: any;
  fail_reason: string | null;
  trace_id: string | null;
  created_at: string;
}

const META_EVENT_OPTIONS = [
  "Lead", "QualifiedLead", "Schedule", "Contact",
  "SubmitApplication", "InitiateCheckout", "Purchase",
];

const FAIL_REASON_PT: Record<string, string> = {
  "NO_MAPPING": "Nenhuma regra encontrada para essa etapa",
  "DUPLICATE_EVENT_ID": "Evento duplicado (já enviado)",
  "MISSING_TOKEN": "Token ausente",
  "DISABLED": "Envio desativado nas configurações",
};

export function MetaAdsSettings() {
  const { profile, role } = useAuth();
  const orgId = profile?.organization_id;
  const profileId = profile?.id;
  const isAdmin = role === "admin";

  return (
    <div className="space-y-6">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Esta tela configura a <strong>conexão</strong> com a Meta Conversions API (CAPI).
          O envio de eventos é feito exclusivamente via <strong>Automações → Ação "Enviar para Meta (CAPI)"</strong>.
        </AlertDescription>
      </Alert>

      {orgId && profileId && isAdmin && (
        <TechStatusChecklist orgId={orgId} profileId={profileId} />
      )}

      {orgId && profileId && (
        <Tabs defaultValue="connection">
          <TabsList className="font-poppins">
            <TabsTrigger value="connection">Conexão</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className="mt-4">
            <ConnectionCard orgId={orgId} profileId={profileId} />
          </TabsContent>
          <TabsContent value="logs" className="mt-4">
            <LogsCard orgId={orgId} profileId={profileId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ═══════════ EDGE FUNCTION HELPER ═══════════
const SUPABASE_URL = "https://tapbwlmdvluqdgvixkxf.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhcGJ3bG1kdmx1cWRndml4a3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2MDY0NDgsImV4cCI6MjA3MDE4MjQ0OH0.U2p9jneQ6Lcgu672Z8W-KnKhLgMLygDk1jB4a0YIwvQ";

async function callMetaCapiEndpoint(body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/meta-capi-settings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

// ═══════════ ERROR DETAIL MODAL ═══════════
function ErrorDetailModal({
  open,
  onClose,
  error,
}: {
  open: boolean;
  onClose: () => void;
  error: {
    endpoint: string;
    httpStatus: number;
    response: any;
    message: string;
    orgId?: string;
    profileId?: string;
  } | null;
}) {
  if (!error) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-poppins flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" /> Detalhes do Erro (Admin)
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label className="text-xs font-semibold">Endpoint</Label>
            <pre className="bg-muted p-2 rounded text-xs mt-1 font-mono">{error.endpoint}</pre>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs font-semibold">HTTP Status</Label>
              <p className="font-mono">{error.httpStatus}</p>
            </div>
            <div>
              <Label className="text-xs font-semibold">Código</Label>
              <p className="font-mono">{error.response?.code || "N/A"}</p>
            </div>
          </div>
          <div>
            <Label className="text-xs font-semibold">Mensagem</Label>
            <p className="text-destructive">{error.message}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs font-semibold">Organization ID</Label>
              <p className="font-mono text-xs break-all">{error.orgId || "N/A"}</p>
            </div>
            <div>
              <Label className="text-xs font-semibold">Profile ID</Label>
              <p className="font-mono text-xs break-all">{error.profileId || "N/A"}</p>
            </div>
          </div>
          <div>
            <Label className="text-xs font-semibold">Response JSON</Label>
            <pre className="bg-muted p-2 rounded text-xs mt-1 max-h-48 overflow-auto font-mono">
              {JSON.stringify(error.response, null, 2)}
            </pre>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════ TECH STATUS CHECKLIST ═══════════
function TechStatusChecklist({ orgId, profileId }: { orgId: string; profileId: string }) {
  const [status, setStatus] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const check = async () => {
    setLoading(true);
    try {
      const { status: httpStatus, data } = await callMetaCapiEndpoint({
        action: "status",
        profile_id: profileId,
        organization_id: orgId,
      });
      if (data.ok) {
        setStatus({ ...data.status, api_settings_ok: true, http_status: httpStatus });
      } else {
        setStatus({ api_settings_ok: false, error: data.message, http_status: httpStatus });
      }
    } catch (err: any) {
      setStatus({ api_settings_ok: false, error: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded) check();
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const StatusIcon = ({ ok }: { ok: boolean }) =>
    ok ? <Check className="h-4 w-4 text-emerald-500" /> : <X className="h-4 w-4 text-destructive" />;

  return (
    <Card className="border-dashed">
      <CardHeader className="py-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-poppins flex items-center gap-2">
            🔧 Status Técnico (Admin)
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 text-xs">
            {expanded ? "Fechar" : "Verificar"}
          </Button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Verificando...
            </div>
          ) : status ? (
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                <StatusIcon ok={!!status.user_id} />
                <span>Session user_id detectado</span>
                {status.user_id && <span className="font-mono text-xs text-muted-foreground">{String(status.user_id).substring(0, 12)}...</span>}
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon ok={!!status.organization_id} />
                <span>organization_id detectado</span>
                {status.organization_id && <span className="font-mono text-xs text-muted-foreground">{String(status.organization_id).substring(0, 12)}...</span>}
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon ok={status.org_exists === true} />
                <span>organizations row exists</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon ok={status.is_admin === true} />
                <span>is_admin = true</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon ok={status.settings_exists === true} />
                <span>meta_capi_settings row exists</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon ok={status.api_settings_ok === true} />
                <span>API /meta-capi-settings funcionando</span>
              </div>
              {status.error && (
                <Alert variant="destructive" className="mt-2">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{status.error}</AlertDescription>
                </Alert>
              )}
              <Button variant="outline" size="sm" className="mt-2" onClick={check}>
                <RefreshCw className="mr-2 h-3 w-3" /> Reverificar
              </Button>
            </div>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}

// ═══════════ CONNECTION CARD ═══════════
function ConnectionCard({ orgId, profileId }: { orgId: string; profileId: string }) {
  const [config, setConfig] = useState<CapiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pixelId, setPixelId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [testEventCode, setTestEventCode] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [domain, setDomain] = useState("");
  const [errorDetail, setErrorDetail] = useState<any>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("meta_capi_settings")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (data) {
      setConfig(data);
      setPixelId(data.pixel_id || "");
      setAccessToken(data.access_token || "");
      setTestEventCode(data.test_event_code || "");
      setEnabled(data.enabled);
      setTestMode(data.test_mode || false);
      setDomain(data.domain || "");
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!pixelId || !accessToken) {
      toast.error("Pixel ID e Access Token são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      const { status, data } = await callMetaCapiEndpoint({
        action: "save",
        profile_id: profileId,
        organization_id: orgId,
        payload: {
          pixel_id: pixelId,
          access_token: accessToken,
          test_event_code: testEventCode || null,
          enabled,
          test_mode: testMode,
          domain: domain || null,
        },
      });

      if (data.ok) {
        toast.success("Configurações salvas!");
        setSettingsSaved(true);
        load();
      } else {
        toast.error(`Erro ao salvar: ${data.message || "Erro desconhecido"}`);
        setErrorDetail({
          endpoint: "POST /functions/v1/meta-capi-settings (action=save)",
          httpStatus: status,
          response: data,
          message: data.message || "Erro desconhecido",
          orgId,
          profileId,
        });
      }
    } catch (err: any) {
      toast.error("Erro de rede ao salvar");
      setErrorDetail({
        endpoint: "POST /functions/v1/meta-capi-settings (action=save)",
        httpStatus: 0,
        response: { error: err.message },
        message: err.message,
        orgId,
        profileId,
      });
    } finally {
      setSaving(false);
    }
  };

  // Track if settings exist (saved at least once)
  useEffect(() => {
    setSettingsSaved(!!config?.id);
  }, [config]);

  const handleTest = async () => {
    if (!settingsSaved) {
      toast.warning("Salve as configurações antes de testar a conexão.");
      return;
    }
    setTesting(true);
    try {
      const { status, data } = await callMetaCapiEndpoint({
        action: "test",
        profile_id: profileId,
        organization_id: orgId,
      });

      if (data.ok) {
        toast.success(data.message || "Conexão OK!");
      } else {
        const msg =
          data.code === "MISSING_PERMISSION"
            ? "Seu token não tem permissão para enviar eventos para este Pixel/Dataset. Use System User no Business Manager com acesso ao Dataset + permissões de evento."
            : data.message || "Erro desconhecido";
        toast.error(msg, { duration: 8000 });
        setErrorDetail({
          endpoint: "POST /functions/v1/meta-capi-settings (action=test)",
          httpStatus: status,
          response: data,
          message: msg,
          orgId,
          profileId,
        });
      }
    } catch (err: any) {
      toast.error("Erro de rede ao testar conexão");
      setErrorDetail({
        endpoint: "POST /functions/v1/meta-capi-settings (action=test)",
        httpStatus: 0,
        response: { error: err.message },
        message: err.message,
        orgId,
        profileId,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleToggleEnabled = async (val: boolean) => {
    if (val && (!pixelId || !accessToken)) {
      toast.error("Configure Pixel ID e Access Token antes de ativar");
      return;
    }
    setEnabled(val);
    if (config?.id) {
      await callMetaCapiEndpoint({
        action: "save",
        profile_id: profileId,
        organization_id: orgId,
        payload: {
          pixel_id: pixelId,
          access_token: accessToken,
          test_event_code: testEventCode || null,
          enabled: val,
          test_mode: testMode,
          domain: domain || null,
        },
      });
    }
  };

  const getStatusBadge = () => {
    if (!config) return <Badge variant="secondary">Não configurado</Badge>;
    if (!enabled) return <Badge variant="secondary">Desativado</Badge>;
    return <Badge variant="default" className="bg-emerald-600"><Check className="h-3 w-3 mr-1" /> Conectado</Badge>;
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-poppins">Conexão Meta (CAPI)</CardTitle>
              <CardDescription>Dataset ID (Pixel ID) e Access Token para envio de eventos</CardDescription>
            </div>
            {getStatusBadge()}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="capi-pixel-id">Dataset ID / Pixel ID</Label>
            <Input id="capi-pixel-id" placeholder="123456789012345" value={pixelId} onChange={(e) => setPixelId(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Encontre no{" "}
              <a href="https://business.facebook.com/events_manager2" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                Events Manager <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="capi-token">Access Token</Label>
            <Input id="capi-token" type="password" placeholder="EAAxxxxxxxxxxxxx..." value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="capi-test-code">Test Event Code (opcional)</Label>
            <Input id="capi-test-code" placeholder="TEST12345" value={testEventCode} onChange={(e) => setTestEventCode(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="capi-domain">Domínio / Site (opcional)</Label>
            <Input id="capi-domain" placeholder="https://meusite.com.br" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <p className="text-xs text-muted-foreground">Usado como event_source_url nos eventos</p>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Ativar envio via CAPI</Label>
              <p className="text-sm text-muted-foreground">Habilita envio automático de eventos</p>
            </div>
            <Switch checked={enabled} onCheckedChange={handleToggleEnabled} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Modo Teste</Label>
              <p className="text-sm text-muted-foreground">Eventos com Test Event Code</p>
            </div>
            <Switch checked={testMode} onCheckedChange={setTestMode} />
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !pixelId || !accessToken}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
            <div className="relative group">
              <Button variant="outline" onClick={handleTest} disabled={testing || !settingsSaved || !pixelId || !accessToken}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
                Testar Conexão
              </Button>
              {!settingsSaved && (
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-xs px-2 py-1 rounded shadow whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border">
                  Salve as configurações antes de testar
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <ErrorDetailModal
        open={!!errorDetail}
        onClose={() => setErrorDetail(null)}
        error={errorDetail}
      />
    </>
  );
}


// ═══════════ LOGS CARD (reads from event_dispatch_queue) ═══════════
function LogsCard({ orgId, profileId }: { orgId: string; profileId: string }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("7d");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { status: httpStatus, data } = await callMetaCapiEndpoint({
        action: "queue_logs",
        profile_id: profileId,
        organization_id: orgId,
        payload: {
          status: statusFilter,
          event_name: eventFilter,
          period: periodFilter,
        },
      });

      if (!data.ok) {
        throw new Error(`HTTP ${httpStatus}: ${data.message || "Erro ao carregar fila"}`);
      }

      setItems(data.items || []);
    } catch (e: any) {
      toast.error(e.message || "Erro ao carregar fila");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, profileId, statusFilter, eventFilter, periodFilter]);

  useEffect(() => { load(); }, [load]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge variant="outline" className="gap-1 text-xs text-emerald-600 border-emerald-200"><Check className="h-3 w-3" /> Enviado</Badge>;
      case "error":
        return <Badge variant="destructive" className="gap-1 text-xs"><X className="h-3 w-3" /> Erro</Badge>;
      case "pending":
        return <Badge variant="secondary" className="gap-1 text-xs">⏳ Pendente</Badge>;
      case "processing":
        return <Badge variant="secondary" className="gap-1 text-xs">⚙️ Processando</Badge>;
      default:
        return <Badge variant="secondary" className="gap-1 text-xs">{status}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="font-poppins">Fila de Eventos</CardTitle>
            <CardDescription>Histórico de envio de eventos (com retry automático)</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos status</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="processing">Processando</SelectItem>
              <SelectItem value="success">Sucesso</SelectItem>
              <SelectItem value="error">Erro</SelectItem>
            </SelectContent>
          </Select>
          <Select value={eventFilter} onValueChange={setEventFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos eventos</SelectItem>
              {META_EVENT_OPTIONS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={periodFilter} onValueChange={setPeriodFilter}>
            <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7d</SelectItem>
              <SelectItem value="30d">Últimos 30d</SelectItem>
              <SelectItem value="all">Tudo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum evento encontrado.</p>
        ) : (
          <ScrollArea className="h-[500px]">
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{item.event_name}</span>
                      {getStatusBadge(item.status)}
                      <span className="text-[10px] text-muted-foreground font-mono">{item.channel}</span>
                      {item.attempts > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          tentativa {item.attempts}/{item.max_attempts}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(item.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                      {item.sent_at && (
                        <span className="ml-2 text-emerald-600">
                          → enviado {format(new Date(item.sent_at), "HH:mm:ss", { locale: ptBR })}
                        </span>
                      )}
                      {item.lead_id && <span className="ml-2 font-mono text-[10px] bg-muted px-1 py-0.5 rounded">Lead: {item.lead_id.substring(0, 8)}</span>}
                    </p>
                    {item.last_error && (
                      <p className="text-xs text-destructive mt-1 truncate">{item.last_error}</p>
                    )}
                    {item.next_retry_at && item.status === "pending" && item.attempts > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Próxima tentativa: {format(new Date(item.next_retry_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                      </p>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedItem(item)}>
                    <Eye className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>

      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-poppins">Detalhes: {selectedItem?.event_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Status:</span> {selectedItem && getStatusBadge(selectedItem.status)}</div>
              <div><span className="text-muted-foreground">Canal:</span> <span className="font-mono">{selectedItem?.channel}</span></div>
              <div><span className="text-muted-foreground">Tentativas:</span> <span className="font-mono">{selectedItem?.attempts}/{selectedItem?.max_attempts}</span></div>
              <div><span className="text-muted-foreground">Lead ID:</span> <span className="font-mono text-xs">{selectedItem?.lead_id?.substring(0, 12) || "—"}</span></div>
            </div>
            {selectedItem?.last_error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">{selectedItem.last_error}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label className="text-xs font-semibold">Event Hash</Label>
              <pre className="text-xs bg-muted p-2 rounded mt-1 font-mono break-all">
                {selectedItem?.event_hash || "N/A"}
              </pre>
            </div>
            <div>
              <Label className="text-xs font-semibold">Payload</Label>
              <pre className="text-xs bg-muted p-2 rounded mt-1 max-h-48 overflow-auto">
                {JSON.stringify(selectedItem?.payload, null, 2) || "N/A"}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
