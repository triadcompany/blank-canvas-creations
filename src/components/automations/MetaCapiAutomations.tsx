import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, Eye, Check, X, Info,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Types ───
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
  "InitiateCheckout", "Purchase",
];

export function MetaCapiAutomations({ orgId }: { orgId: string }) {
  return (
    <div className="space-y-6">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Os envios de eventos para a Meta são definidos como <strong>ações dentro das Automações</strong>.
          A conexão técnica (Pixel ID, Token) é configurada em <strong>Configurações → Meta Ads (CAPI)</strong>.
        </AlertDescription>
      </Alert>

      <LogsCard orgId={orgId} />
    </div>
  );
}

// ═══════════ LOGS CARD ═══════════
function LogsCard({ orgId }: { orgId: string }) {
  const [logs, setLogs] = useState<CapiLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<CapiLog | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("7d");

  const load = useCallback(async () => {
    setLoading(true);
    let query = (supabase as any)
      .from("meta_capi_logs")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (eventFilter !== "all") query = query.eq("meta_event", eventFilter);

    const now = new Date();
    if (periodFilter === "7d") {
      query = query.gte("created_at", new Date(now.getTime() - 7 * 86400000).toISOString());
    } else if (periodFilter === "30d") {
      query = query.gte("created_at", new Date(now.getTime() - 30 * 86400000).toISOString());
    }

    const { data } = await query;
    setLogs(data || []);
    setLoading(false);
  }, [orgId, statusFilter, eventFilter, periodFilter]);

  useEffect(() => { load(); }, [load]);

  const maskPhone = (phone: string | null) => {
    if (!phone) return "—";
    if (phone.length <= 6) return phone;
    return phone.substring(0, 4) + "****" + phone.substring(phone.length - 2);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="font-poppins">Logs Meta CAPI</CardTitle>
            <CardDescription>Histórico de envio de eventos para o Meta</CardDescription>
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
              <SelectItem value="success">Sucesso</SelectItem>
              <SelectItem value="failed">Falha</SelectItem>
              <SelectItem value="skipped">Pulado</SelectItem>
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
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum evento encontrado.</p>
        ) : (
          <ScrollArea className="h-[500px]">
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
                      {log.lead_id && <span className="ml-2 font-mono text-[10px] bg-muted px-1 py-0.5 rounded">Lead: {log.lead_id.substring(0, 8)}</span>}
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
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Status:</span> <Badge variant={selectedLog?.status === "success" ? "outline" : "destructive"} className="ml-1 text-xs">{selectedLog?.status}</Badge></div>
              <div><span className="text-muted-foreground">HTTP:</span> <span className="font-mono">{selectedLog?.http_status || "—"}</span></div>
              <div><span className="text-muted-foreground">Lead ID:</span> <span className="font-mono text-xs">{selectedLog?.lead_id?.substring(0, 12) || "—"}</span></div>
              <div><span className="text-muted-foreground">Trace:</span> <span className="font-mono text-xs">{selectedLog?.trace_id?.substring(0, 12) || "—"}</span></div>
            </div>
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
