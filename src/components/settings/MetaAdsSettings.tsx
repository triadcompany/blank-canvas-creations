import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, TestTube, ExternalLink, Info, Check, X } from "lucide-react";

interface CapiSettings {
  id: string;
  pixel_id: string;
  access_token: string;
  test_event_code: string | null;
  enabled: boolean;
}

export function MetaAdsSettings() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  return (
    <div className="space-y-6">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Configure sua conexão com a Meta Conversions API (CAPI). O mapeamento de eventos e logs de execução
          estão disponíveis em <strong>Automações → Meta Ads (CAPI)</strong>.
        </AlertDescription>
      </Alert>

      {orgId && <ConnectionCard orgId={orgId} />}
    </div>
  );
}

function ConnectionCard({ orgId }: { orgId: string }) {
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
      const payload = {
        pixel_id: pixelId,
        access_token: accessToken,
        test_event_code: testEventCode || null,
        enabled,
        test_mode: testMode,
        domain: domain || null,
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

  const getStatusBadge = () => {
    if (!config) return <Badge variant="secondary">Não configurado</Badge>;
    if (!enabled) return <Badge variant="secondary">Desativado</Badge>;
    return <Badge variant="default" className="bg-emerald-600"><Check className="h-3 w-3 mr-1" /> Conectado</Badge>;
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
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
          <Label htmlFor="capi-pixel-id">Pixel ID / Dataset ID</Label>
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

        <div className="space-y-2">
          <Label htmlFor="capi-domain">Domínio / Site (opcional)</Label>
          <Input id="capi-domain" placeholder="https://meusite.com.br" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <p className="text-xs text-muted-foreground">Usado como event_source_url nos eventos enviados</p>
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Ativar envio via CAPI</Label>
            <p className="text-sm text-muted-foreground">Habilita envio automático de eventos para o Meta</p>
          </div>
          <Switch checked={enabled} onCheckedChange={handleToggleEnabled} />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Modo Teste</Label>
            <p className="text-sm text-muted-foreground">Eventos serão enviados com Test Event Code</p>
          </div>
          <Switch checked={testMode} onCheckedChange={setTestMode} />
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
