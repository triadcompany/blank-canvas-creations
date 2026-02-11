import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
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
  Loader2, Plus, Trash2, Pencil, TestTube, ExternalLink, Info,
  RefreshCw, Eye, Check, X, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Types ───
interface CapiSettings {
  id: string;
  pixel_id: string;
  access_token: string;
  test_event_code: string | null;
  enabled: boolean;
}

interface CapiMapping {
  id: string;
  pipeline_id: string | null;
  stage_id: string;
  meta_event: string;
  enabled: boolean;
  priority: number;
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

interface Pipeline { id: string; name: string; }
interface Stage { id: string; name: string; position: number; }

const META_EVENT_OPTIONS = [
  "Lead", "QualifiedLead", "Schedule", "Contact",
  "InitiateCheckout", "Purchase",
];

// ─── Main Component ───
export function MetaAdsSettings() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  return (
    <div className="space-y-6">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Integre seu CRM com a Meta Conversions API (CAPI) para enviar eventos de conversão
          diretamente para o Facebook/Instagram ao mover leads entre etapas do pipeline.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Conexão</TabsTrigger>
          <TabsTrigger value="mappings">Mapeamento</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-4">
          {orgId && <ConnectionCard orgId={orgId} />}
        </TabsContent>
        <TabsContent value="mappings" className="mt-4">
          {orgId && <MappingsCard orgId={orgId} />}
        </TabsContent>
        <TabsContent value="logs" className="mt-4">
          {orgId && <LogsCard orgId={orgId} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════ CONNECTION CARD ═══════════
function ConnectionCard({ orgId }: { orgId: string }) {
  const [config, setConfig] = useState<CapiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pixelId, setPixelId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [testEventCode, setTestEventCode] = useState("");
  const [enabled, setEnabled] = useState(false);

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
      const payload = {
        pixel_id: pixelId,
        access_token: accessToken,
        test_event_code: testEventCode || null,
        enabled,
        updated_at: new Date().toISOString(),
      };
      if (config?.id) {
        const { error } = await (supabase as any).from("meta_capi_settings").update(payload).eq("id", config.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("meta_capi_settings").insert({ ...payload, organization_id: orgId });
        if (error) throw error;
      }
      toast.success("Configurações salvas!");
      load();
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!pixelId || !accessToken) {
      toast.error("Configure Pixel ID e Access Token primeiro");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${pixelId}?access_token=${accessToken}&fields=id,name`
      );
      const data = await res.json();
      if (res.ok && data.id) {
        toast.success(`Conexão OK! Pixel: ${data.name || data.id}`);
      } else {
        toast.error(`Falha: ${data.error?.message || "Erro desconhecido"}`);
      }
    } catch {
      toast.error("Erro ao testar conexão");
    } finally {
      setTesting(false);
    }
  };

  const handleToggleEnabled = async (val: boolean) => {
    setEnabled(val);
    if (config?.id) {
      await (supabase as any).from("meta_capi_settings").update({ enabled: val, updated_at: new Date().toISOString() }).eq("id", config.id);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-poppins">Conexão Meta (CAPI)</CardTitle>
        <CardDescription>Dataset ID (Pixel ID) e Access Token para envio de eventos</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="capi-pixel-id">Pixel ID</Label>
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
          <p className="text-xs text-amber-600 dark:text-amber-500 font-medium">⚠️ Permissões necessárias: ads_management, business_management</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="capi-test-code">Test Event Code (opcional)</Label>
          <Input id="capi-test-code" placeholder="TEST12345" value={testEventCode} onChange={(e) => setTestEventCode(e.target.value)} />
          <p className="text-xs text-muted-foreground">Usado para validar eventos no Events Manager sem afetar campanhas</p>
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Ativar integração</Label>
            <p className="text-sm text-muted-foreground">Habilita envio automático de eventos</p>
          </div>
          <Switch checked={enabled} onCheckedChange={handleToggleEnabled} />
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving || !pixelId || !accessToken}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing || !pixelId || !accessToken}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
            Testar Conexão
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════ MAPPINGS CARD ═══════════
function MappingsCard({ orgId }: { orgId: string }) {
  const [mappings, setMappings] = useState<CapiMapping[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [allStagesGrouped, setAllStagesGrouped] = useState<{ pipeline: string; stages: Stage[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<CapiMapping | null>(null);
  const [saving, setSaving] = useState(false);

  // form
  const [fPipelineId, setFPipelineId] = useState<string>("");
  const [fStageId, setFStageId] = useState("");
  const [fEvent, setFEvent] = useState("Lead");
  const [fCustomEvent, setFCustomEvent] = useState("");
  const [fPriority, setFPriority] = useState(0);
  const [fEnabled, setFEnabled] = useState(true);
  const [loadingStages, setLoadingStages] = useState(false);

  // name caches
  const [pipelineNames, setPipelineNames] = useState<Record<string, string>>({});
  const [stageNames, setStageNames] = useState<Record<string, string>>({});

  const loadMappings = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("meta_capi_mappings")
      .select("*")
      .eq("organization_id", orgId)
      .order("priority", { ascending: false });

    const items: CapiMapping[] = data || [];
    setMappings(items);

    // resolve names
    const pIds = [...new Set(items.map(m => m.pipeline_id).filter(Boolean))] as string[];
    const sIds = [...new Set(items.map(m => m.stage_id))] as string[];

    if (pIds.length > 0) {
      const { data: pd } = await supabase.from("pipelines").select("id, name").in("id", pIds);
      const n: Record<string, string> = {};
      (pd || []).forEach((p: any) => { n[p.id] = p.name; });
      setPipelineNames(n);
    }
    if (sIds.length > 0) {
      const { data: sd } = await supabase.from("pipeline_stages").select("id, name").in("id", sIds);
      const n: Record<string, string> = {};
      (sd || []).forEach((s: any) => { n[s.id] = s.name; });
      setStageNames(n);
    }
    setLoading(false);
  }, [orgId]);

  const loadPipelines = useCallback(async () => {
    const { data } = await supabase.rpc("get_org_pipelines", { p_org_id: orgId });
    setPipelines((data || []).filter((p: any) => p.is_active).map((p: any) => ({ id: p.id, name: p.name })));
  }, [orgId]);

  const loadStagesForPipeline = async (pipelineId: string) => {
    setLoadingStages(true);
    const { data } = await supabase.rpc("get_pipeline_stages", { p_pipeline_id: pipelineId });
    setStages(
      (data || []).filter((s: any) => s.is_active)
        .map((s: any) => ({ id: s.id, name: s.name, position: s.position }))
        .sort((a: Stage, b: Stage) => a.position - b.position)
    );
    setLoadingStages(false);
  };

  const loadAllStages = async () => {
    setLoadingStages(true);
    const grouped: { pipeline: string; stages: Stage[] }[] = [];
    for (const p of pipelines) {
      const { data } = await supabase.rpc("get_pipeline_stages", { p_pipeline_id: p.id });
      const pStages = (data || [])
        .filter((s: any) => s.is_active)
        .map((s: any) => ({ id: s.id, name: s.name, position: s.position }))
        .sort((a: Stage, b: Stage) => a.position - b.position);
      if (pStages.length > 0) grouped.push({ pipeline: p.name, stages: pStages });
    }
    setAllStagesGrouped(grouped);
    setLoadingStages(false);
  };

  useEffect(() => { loadMappings(); loadPipelines(); }, [loadMappings, loadPipelines]);

  useEffect(() => {
    if (fPipelineId) {
      loadStagesForPipeline(fPipelineId);
      setAllStagesGrouped([]);
    } else if (pipelines.length > 0) {
      loadAllStages();
      setStages([]);
    }
  }, [fPipelineId, pipelines]);

  const resetForm = () => {
    setFPipelineId(""); setFStageId(""); setFEvent("Lead");
    setFCustomEvent(""); setFPriority(0); setFEnabled(true);
    setEditing(null);
  };

  const openNew = () => { resetForm(); setShowDialog(true); };
  const openEdit = (m: CapiMapping) => {
    setEditing(m);
    setFPipelineId(m.pipeline_id || "");
    setFStageId(m.stage_id);
    const isStd = META_EVENT_OPTIONS.includes(m.meta_event);
    setFEvent(isStd ? m.meta_event : "Custom");
    setFCustomEvent(isStd ? "" : m.meta_event);
    setFPriority(m.priority);
    setFEnabled(m.enabled);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!fStageId) { toast.error("Etapa destino é obrigatória"); return; }
    const eventName = fEvent === "Custom" ? fCustomEvent : fEvent;
    if (!eventName) { toast.error("Evento Meta é obrigatório"); return; }

    setSaving(true);
    try {
      const payload = {
        organization_id: orgId,
        pipeline_id: fPipelineId || null,
        stage_id: fStageId,
        meta_event: eventName,
        priority: fPriority,
        enabled: fEnabled,
        updated_at: new Date().toISOString(),
      };

      if (editing) {
        const { error } = await (supabase as any).from("meta_capi_mappings").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("Regra atualizada");
      } else {
        const { error } = await (supabase as any).from("meta_capi_mappings").insert(payload);
        if (error) throw error;
        toast.success("Regra criada");
      }
      setShowDialog(false);
      resetForm();
      loadMappings();
    } catch (err: any) {
      toast.error("Erro: " + (err.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await (supabase as any).from("meta_capi_mappings").delete().eq("id", id);
    toast.success("Regra removida");
    loadMappings();
  };

  const handleToggle = async (id: string, current: boolean) => {
    await (supabase as any).from("meta_capi_mappings").update({ enabled: !current }).eq("id", id);
    loadMappings();
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-poppins">Mapeamento por Etapa</CardTitle>
              <CardDescription>Pipeline + Etapa → Evento Meta</CardDescription>
            </div>
            <Button onClick={openNew} size="sm"><Plus className="mr-2 h-4 w-4" /> Nova Regra</Button>
          </div>
        </CardHeader>
        <CardContent>
          {mappings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma regra criada. Clique em "Nova Regra" para começar.
            </p>
          ) : (
            <ScrollArea className="max-h-[500px]">
              <div className="space-y-3">
                {mappings.map((m) => {
                  const pName = m.pipeline_id ? pipelineNames[m.pipeline_id] : "Qualquer";
                  const sName = stageNames[m.stage_id];
                  const isInvalid = !sName;

                  return (
                    <div key={m.id} className={`flex items-center justify-between p-3 border rounded-lg ${isInvalid ? "border-destructive/50 bg-destructive/5" : ""} ${!m.enabled ? "opacity-60" : ""}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isInvalid && <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />}
                          <span className="text-sm font-medium">{pName || "Pipeline?"}</span>
                          <span className="text-muted-foreground text-xs">→</span>
                          <span className="text-sm font-medium">{sName || "Etapa?"}</span>
                          <span className="text-muted-foreground text-xs">→</span>
                          <Badge variant="secondary" className="text-xs">{m.meta_event}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Prioridade: {m.priority}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <Switch checked={m.enabled} onCheckedChange={() => handleToggle(m.id, m.enabled)} />
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(m)}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(m.id)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-poppins">{editing ? "Editar Regra" : "Nova Regra"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Pipeline (opcional = qualquer)</Label>
              <Select value={fPipelineId} onValueChange={(v) => { setFPipelineId(v === "__any__" ? "" : v); setFStageId(""); }}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Qualquer pipeline" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Qualquer pipeline</SelectItem>
                  {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Etapa destino</Label>
              {loadingStages ? (
                <div className="flex items-center gap-2 mt-1.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
              ) : fPipelineId ? (
                <Select value={fStageId} onValueChange={setFStageId}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : allStagesGrouped.length > 0 ? (
                <Select value={fStageId} onValueChange={setFStageId}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
                  <SelectContent>
                    {allStagesGrouped.map((g) => (
                      <div key={g.pipeline}>
                        <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">{g.pipeline}</p>
                        {g.stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground mt-1.5">Nenhuma etapa encontrada</p>
              )}
            </div>

            <div>
              <Label>Evento Meta</Label>
              <Select value={fEvent} onValueChange={setFEvent}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {META_EVENT_OPTIONS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  <SelectItem value="Custom">Custom (texto livre)</SelectItem>
                </SelectContent>
              </Select>
              {fEvent === "Custom" && (
                <Input className="mt-2" placeholder="Nome do evento personalizado" value={fCustomEvent} onChange={(e) => setFCustomEvent(e.target.value)} />
              )}
            </div>

            <div>
              <Label>Prioridade</Label>
              <Input type="number" className="mt-1.5" value={fPriority} onChange={(e) => setFPriority(parseInt(e.target.value) || 0)} />
              <p className="text-xs text-muted-foreground mt-1">Maior = executa primeiro</p>
            </div>

            <div className="flex items-center justify-between">
              <Label>Ativa</Label>
              <Switch checked={fEnabled} onCheckedChange={setFEnabled} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !fStageId}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Atualizar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ═══════════ LOGS CARD ═══════════
function LogsCard({ orgId }: { orgId: string }) {
  const [logs, setLogs] = useState<CapiLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<CapiLog | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("meta_capi_logs")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(50);
    setLogs(data || []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="font-poppins">Logs Meta CAPI</CardTitle>
            <CardDescription>Últimos 50 envios de eventos</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum evento registrado ainda.</p>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{log.meta_event}</span>
                      {log.status === "success" ? (
                        <Badge variant="outline" className="gap-1 text-xs text-emerald-600 border-emerald-200"><Check className="h-3 w-3" /> Enviado</Badge>
                      ) : log.status === "failed" ? (
                        <Badge variant="destructive" className="gap-1 text-xs"><X className="h-3 w-3" /> Erro</Badge>
                      ) : log.status === "skipped" ? (
                        <Badge variant="secondary" className="gap-1 text-xs">Pulado</Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 text-xs"><Loader2 className="h-3 w-3 animate-spin" /> Pendente</Badge>
                      )}
                      {log.http_status && <span className="text-[10px] text-muted-foreground font-mono">HTTP {log.http_status}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                      {log.trace_id && <span className="ml-2 font-mono text-[10px] bg-muted px-1 py-0.5 rounded">{log.trace_id.substring(0, 12)}</span>}
                    </p>
                    {log.fail_reason && <p className="text-xs text-destructive mt-1 truncate">{log.fail_reason}</p>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedLog(log)}>
                    <Eye className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>

      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-poppins">Detalhes: {selectedLog?.meta_event}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-semibold">Request</Label>
              <pre className="text-xs bg-muted p-2 rounded mt-1 max-h-40 overflow-auto">
                {JSON.stringify(selectedLog?.request_json, null, 2) || "N/A"}
              </pre>
            </div>
            <div>
              <Label className="text-xs font-semibold">Response</Label>
              <pre className="text-xs bg-muted p-2 rounded mt-1 max-h-40 overflow-auto">
                {JSON.stringify(selectedLog?.response_json, null, 2) || "N/A"}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
