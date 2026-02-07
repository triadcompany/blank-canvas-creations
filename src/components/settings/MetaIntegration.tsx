import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMetaIntegration } from "@/hooks/useMetaIntegration";
import { Loader2, Check, X, ExternalLink, TestTube, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

export function MetaIntegration() {
  const { config, recentEvents, loading, saveConfig, testConnection, refreshEvents } = useMetaIntegration();
  const [pixelId, setPixelId] = useState(config?.pixel_id || "");
  const [accessToken, setAccessToken] = useState(config?.access_token || "");
  const [saving, setSaving] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    await saveConfig({
      pixel_id: pixelId,
      access_token: accessToken,
    });
    setSaving(false);
  };

  const handleToggle = async (field: string, value: boolean) => {
    await saveConfig({ [field]: value });
  };

  return (
    <div className="space-y-6">
      {/* Informações */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Integre seu CRM com o Meta Pixel para enviar eventos de conversão diretamente para o Facebook/Instagram,
          otimizando suas campanhas publicitárias com dados reais de vendas.
        </AlertDescription>
      </Alert>

      {/* Configuração de Credenciais */}
      <Card>
        <CardHeader>
          <CardTitle>Configuração do Meta Pixel</CardTitle>
          <CardDescription>
            Configure as credenciais do seu Pixel do Facebook/Instagram
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pixel-id">Pixel ID</Label>
            <Input
              id="pixel-id"
              placeholder="123456789012345"
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Encontre seu Pixel ID no{" "}
              <a
                href="https://business.facebook.com/events_manager2"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Events Manager <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="access-token">Access Token</Label>
            <Input
              id="access-token"
              type="password"
              placeholder="EAAxxxxxxxxxxxxx..."
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
            />
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                Gere um token no{" "}
                <a
                  href="https://business.facebook.com/settings/system-users"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  Business Manager <ExternalLink className="h-3 w-3" />
                </a>
              </p>
              <p className="text-amber-600 dark:text-amber-500 font-medium">
                ⚠️ O token precisa ter as permissões: ads_management e business_management
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving || !pixelId || !accessToken}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar Credenciais
            </Button>
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={!config?.pixel_id || !config?.access_token}
            >
              <TestTube className="mr-2 h-4 w-4" />
              Testar Conexão
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Configuração de Eventos */}
      {config && (
        <Card>
          <CardHeader>
            <CardTitle>Eventos Personalizados</CardTitle>
            <CardDescription>
              Escolha quais eventos enviar para o Meta quando leads mudarem de estágio
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Lead Qualificado */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Lead Qualificado</Label>
                <p className="text-sm text-muted-foreground">
                  Evento padrão "Lead" quando lead entra no estágio "Qualificado"
                </p>
              </div>
              <Switch
                checked={config.track_lead_qualificado}
                onCheckedChange={(checked) => handleToggle("track_lead_qualificado", checked)}
              />
            </div>

            <Separator />

            {/* Lead Super Qualificado */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Lead Super Qualificado</Label>
                <p className="text-sm text-muted-foreground">
                  Evento custom quando proposta é enviada ao lead
                </p>
              </div>
              <Switch
                checked={config.track_lead_super_qualificado}
                onCheckedChange={(checked) => handleToggle("track_lead_super_qualificado", checked)}
              />
            </div>

            <Separator />

            {/* Lead Veio na Loja */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Lead Veio na Loja</Label>
                <p className="text-sm text-muted-foreground">
                  Evento custom quando lead agenda e visita a loja
                </p>
              </div>
              <Switch
                checked={config.track_lead_veio_loja}
                onCheckedChange={(checked) => handleToggle("track_lead_veio_loja", checked)}
              />
            </div>

            <Separator />

            {/* Lead Comprou */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Lead Comprou</Label>
                <p className="text-sm text-muted-foreground">
                  Evento padrão "Purchase" quando lead fecha a venda
                </p>
              </div>
              <Switch
                checked={config.track_lead_comprou}
                onCheckedChange={(checked) => handleToggle("track_lead_comprou", checked)}
              />
            </div>

            <Separator />

            {/* Status da Integração */}
            <div className="flex items-center justify-between pt-2">
              <div className="space-y-0.5">
                <Label>Status da Integração</Label>
                <p className="text-sm text-muted-foreground">
                  Ativar ou desativar o envio de eventos
                </p>
              </div>
              <Switch
                checked={config.is_active}
                onCheckedChange={(checked) => handleToggle("is_active", checked)}
              />
            </div>

            {/* Modo de Teste */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Modo de Teste</Label>
                <p className="text-sm text-muted-foreground">
                  Eventos serão marcados como teste no Meta Events Manager
                </p>
              </div>
              <Switch
                checked={config.test_mode}
                onCheckedChange={(checked) => handleToggle("test_mode", checked)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Últimos Eventos Enviados */}
      {config && recentEvents.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Últimos Eventos Enviados</CardTitle>
                <CardDescription>Histórico dos últimos 10 eventos</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={refreshEvents}>
                Atualizar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {recentEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{event.event_name}</span>
                        {event.success ? (
                          <Badge variant="outline" className="gap-1">
                            <Check className="h-3 w-3" />
                            Enviado
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <X className="h-3 w-3" />
                            Erro
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(event.created_at).toLocaleString('pt-BR')}
                      </p>
                      {event.error_message && (
                        <p className="text-xs text-destructive mt-1">{event.error_message}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Documentação */}
      <Card>
        <CardHeader>
          <CardTitle>Como Usar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <h4 className="font-semibold mb-1">1. Configure o Pixel</h4>
            <p className="text-muted-foreground">
              Insira o Pixel ID e Access Token do seu Meta Business Manager
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-1">2. Escolha os Eventos</h4>
            <p className="text-muted-foreground">
              Ative os eventos que você quer rastrear no seu funil de vendas
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-1">3. Teste a Integração</h4>
            <p className="text-muted-foreground">
              Use o modo de teste para validar eventos no Meta Events Manager
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-1">4. Otimize suas Campanhas</h4>
            <p className="text-muted-foreground">
              Crie campanhas otimizadas para cada evento no Meta Ads Manager
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
