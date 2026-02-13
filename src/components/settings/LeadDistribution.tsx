import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Settings, Users, Loader2, Save, Megaphone, MessageCircle, UserCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSupabaseProfiles } from '@/hooks/useSupabaseProfiles';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';

interface BucketSettings {
  id?: string;
  organization_id: string;
  bucket: 'traffic' | 'non_traffic';
  enabled: boolean;
  mode: 'auto' | 'fixed_user';
  auto_assign_user_ids: string[];
  fixed_user_id: string | null;
}

interface GlobalSettings {
  id?: string;
  organization_id: string;
  enabled: boolean;
}

interface RoutingState {
  bucket: string;
  last_assigned_user_id: string | null;
}

const DEFAULT_BUCKET = (bucket: 'traffic' | 'non_traffic', orgId: string): BucketSettings => ({
  organization_id: orgId,
  bucket,
  enabled: true,
  mode: 'auto',
  auto_assign_user_ids: [],
  fixed_user_id: null,
});

const LeadDistribution: React.FC = () => {
  const { profile, isAdmin, orgId: authOrgId } = useAuth();
  const { profiles } = useSupabaseProfiles();
  const orgId = profile?.organization_id || authOrgId || '';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [globalSettingsId, setGlobalSettingsId] = useState<string | undefined>();
  const [trafficSettings, setTrafficSettings] = useState<BucketSettings>(DEFAULT_BUCKET('traffic', orgId));
  const [nonTrafficSettings, setNonTrafficSettings] = useState<BucketSettings>(DEFAULT_BUCKET('non_traffic', orgId));
  const [routingStates, setRoutingStates] = useState<RoutingState[]>([]);

  const fetchData = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      // Fetch global settings from whatsapp_routing_settings
      const { data: globalData } = await supabase
        .from('whatsapp_routing_settings')
        .select('id, enabled')
        .eq('organization_id', orgId)
        .maybeSingle();

      if (globalData) {
        setGlobalEnabled(globalData.enabled);
        setGlobalSettingsId(globalData.id);
      }

      // Fetch per-bucket settings
      const { data: bucketData } = await supabase
        .from('whatsapp_routing_bucket_settings')
        .select('*')
        .eq('organization_id', orgId);

      if (bucketData) {
        for (const row of bucketData) {
          const parsed: BucketSettings = {
            id: row.id,
            organization_id: row.organization_id,
            bucket: row.bucket as 'traffic' | 'non_traffic',
            enabled: row.enabled,
            mode: row.mode as 'auto' | 'fixed_user',
            auto_assign_user_ids: (row.auto_assign_user_ids as string[]) || [],
            fixed_user_id: row.fixed_user_id,
          };
          if (row.bucket === 'traffic') setTrafficSettings(parsed);
          else setNonTrafficSettings(parsed);
        }
      }

      // Fetch routing state
      const { data: stateData } = await supabase
        .from('whatsapp_routing_state')
        .select('bucket, last_assigned_user_id')
        .eq('organization_id', orgId);

      setRoutingStates(stateData || []);
    } catch (err) {
      console.error('Error fetching distribution settings:', err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!orgId || !isAdmin) return;
    setSaving(true);
    try {
      // Save global toggle
      if (globalSettingsId) {
        const { error: gErr } = await supabase
          .from('whatsapp_routing_settings')
          .update({ enabled: globalEnabled, updated_at: new Date().toISOString() })
          .eq('id', globalSettingsId);
        if (gErr) { console.error('Global update error:', gErr); toast.error('Erro ao atualizar: ' + gErr.message); setSaving(false); return; }
      } else {
        const { data, error: gErr } = await supabase
          .from('whatsapp_routing_settings')
          .insert({ organization_id: orgId, enabled: globalEnabled })
          .select('id')
          .single();
        if (gErr) { console.error('Global insert error:', gErr); toast.error('Erro ao inserir: ' + gErr.message); setSaving(false); return; }
        if (data) setGlobalSettingsId(data.id);
      }

      // Save each bucket
      for (const settings of [trafficSettings, nonTrafficSettings]) {
        const payload = {
          organization_id: orgId,
          bucket: settings.bucket,
          enabled: settings.enabled,
          mode: settings.mode,
          auto_assign_user_ids: settings.auto_assign_user_ids,
          fixed_user_id: settings.mode === 'fixed_user' ? settings.fixed_user_id : null,
          updated_at: new Date().toISOString(),
        };

        if (settings.id) {
          const { error: bErr } = await supabase
            .from('whatsapp_routing_bucket_settings')
            .update(payload)
            .eq('id', settings.id);
          if (bErr) { console.error('Bucket update error:', bErr); toast.error('Erro bucket: ' + bErr.message); }
        } else {
          const { data, error: bErr } = await supabase
            .from('whatsapp_routing_bucket_settings')
            .insert(payload)
            .select('id')
            .single();
          if (bErr) { console.error('Bucket insert error:', bErr); toast.error('Erro bucket: ' + bErr.message); }
          if (data) {
            if (settings.bucket === 'traffic') setTrafficSettings(s => ({ ...s, id: data.id }));
            else setNonTrafficSettings(s => ({ ...s, id: data.id }));
          }
        }
      }

      toast.success('Configurações salvas com sucesso');
      await fetchData();
    } catch (err: any) {
      console.error('Error saving settings:', err);
      toast.error('Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  };

  const getUserName = (userId: string) => {
    const p = profiles.find(pr => pr.user_id === userId || pr.id === userId);
    return p?.name || 'Usuário desconhecido';
  };

  const getNextInQueue = (bucket: 'traffic' | 'non_traffic') => {
    const settings = bucket === 'traffic' ? trafficSettings : nonTrafficSettings;
    if (settings.mode !== 'auto' || settings.auto_assign_user_ids.length === 0) return null;
    const state = routingStates.find(s => s.bucket === bucket);
    if (!state?.last_assigned_user_id) return getUserName(settings.auto_assign_user_ids[0]);
    const lastIdx = settings.auto_assign_user_ids.indexOf(state.last_assigned_user_id);
    const nextIdx = (lastIdx + 1) % settings.auto_assign_user_ids.length;
    return getUserName(settings.auto_assign_user_ids[nextIdx]);
  };

  const toggleUserInBucket = (bucket: 'traffic' | 'non_traffic', userId: string) => {
    const setter = bucket === 'traffic' ? setTrafficSettings : setNonTrafficSettings;
    setter(prev => {
      const ids = prev.auto_assign_user_ids.includes(userId)
        ? prev.auto_assign_user_ids.filter(id => id !== userId)
        : [...prev.auto_assign_user_ids, userId];
      return { ...prev, auto_assign_user_ids: ids };
    });
  };

  const readOnly = !isAdmin;

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const renderBucketTab = (bucket: 'traffic' | 'non_traffic') => {
    const settings = bucket === 'traffic' ? trafficSettings : nonTrafficSettings;
    const setter = bucket === 'traffic' ? setTrafficSettings : setNonTrafficSettings;
    const nextUser = getNextInQueue(bucket);

    return (
      <div className="space-y-5 pt-2">
        {/* Enable bucket */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Bucket ativo</Label>
            <p className="text-xs text-muted-foreground">
              {bucket === 'traffic'
                ? 'Distribuir leads vindos de anúncios'
                : 'Distribuir leads orgânicos / clientes antigos'}
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(checked) => setter(s => ({ ...s, enabled: checked }))}
            disabled={readOnly}
          />
        </div>

        {settings.enabled && (
          <>
            {/* Mode */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Modo de distribuição</Label>
              <RadioGroup
                value={settings.mode}
                onValueChange={(v) => setter(s => ({ ...s, mode: v as 'auto' | 'fixed_user' }))}
                disabled={readOnly}
                className="space-y-2"
              >
                <div className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors">
                  <RadioGroupItem value="auto" id={`${bucket}-auto`} />
                  <Label htmlFor={`${bucket}-auto`} className="cursor-pointer flex-1">
                    <span className="font-medium text-sm">Automático (Round-robin)</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Distribui alternando entre os usuários selecionados
                    </p>
                  </Label>
                </div>
                <div className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors">
                  <RadioGroupItem value="fixed_user" id={`${bucket}-fixed`} />
                  <Label htmlFor={`${bucket}-fixed`} className="cursor-pointer flex-1">
                    <span className="font-medium text-sm">Usuário único</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Todos os leads deste bucket vão para um único responsável
                    </p>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Auto mode: multi-select users */}
            {settings.mode === 'auto' && (
              <div className="space-y-3">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Usuários que recebem leads
                </Label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {profiles.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer"
                    >
                      <Checkbox
                        checked={settings.auto_assign_user_ids.includes(p.user_id)}
                        onCheckedChange={() => toggleUserInBucket(bucket, p.user_id)}
                        disabled={readOnly}
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">({p.role})</span>
                      </div>
                    </label>
                  ))}
                </div>

                {/* Status */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Usuários ativos</p>
                    <p className="text-sm font-semibold">{settings.auto_assign_user_ids.length}</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Próximo na fila</p>
                    <p className="text-sm font-semibold">{nextUser || 'N/A'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Fixed user mode */}
            {settings.mode === 'fixed_user' && (
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <UserCheck className="h-4 w-4" />
                  Usuário responsável
                </Label>
                <Select
                  value={settings.fixed_user_id || ''}
                  onValueChange={(v) => setter(s => ({ ...s, fixed_user_id: v }))}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um usuário" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((p) => (
                      <SelectItem key={p.user_id} value={p.user_id}>
                        {p.name} ({p.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Global toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Distribuição Automática de Leads
          </CardTitle>
          <CardDescription>
            Configure como os leads do WhatsApp devem ser distribuídos automaticamente para os vendedores
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>Distribuição Automática</Label>
              <p className="text-sm text-muted-foreground">
                Quando ativada, os leads serão distribuídos automaticamente conforme as regras por bucket
              </p>
            </div>
            <Switch
              checked={globalEnabled}
              onCheckedChange={setGlobalEnabled}
              disabled={readOnly}
            />
          </div>
        </CardContent>
      </Card>

      {/* Per-bucket config with tabs */}
      {globalEnabled && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Configuração por Bucket
            </CardTitle>
            <CardDescription>
              Configure filas separadas para tráfego (ads) e não-tráfego (orgânico)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="traffic">
              <TabsList className="w-full">
                <TabsTrigger value="traffic" className="flex-1 gap-2">
                  <Megaphone className="h-4 w-4" />
                  Tráfego
                </TabsTrigger>
                <TabsTrigger value="non_traffic" className="flex-1 gap-2">
                  <MessageCircle className="h-4 w-4" />
                  Não-tráfego
                </TabsTrigger>
              </TabsList>
              <TabsContent value="traffic">
                {renderBucketTab('traffic')}
              </TabsContent>
              <TabsContent value="non_traffic">
                {renderBucketTab('non_traffic')}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Save */}
      {isAdmin && (
        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Salvar Configurações
        </Button>
      )}

      {!isAdmin && (
        <p className="text-sm text-muted-foreground text-center">
          Somente administradores podem alterar estas configurações.
        </p>
      )}
    </div>
  );
};

export default LeadDistribution;
