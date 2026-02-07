import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Play, RotateCcw, Users, Target } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export function TestLeadDistribution() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [distributionUsers, setDistributionUsers] = useState<any[]>([]);
  const [recentAssignments, setRecentAssignments] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Carregar settings
      const { data: settingsData } = await supabase
        .from('lead_distribution_settings')
        .select('*')
        .eq('organization_id', profile?.organization_id)
        .single();

      setSettings(settingsData);

      // Carregar usuários da distribuição
      if (settingsData) {
        const { data: usersData } = await supabase
          .from('lead_distribution_users')
          .select('*')
          .eq('distribution_setting_id', settingsData.id)
          .order('order_position');

        setDistributionUsers(usersData || []);
      }

      // Carregar profiles
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, name, user_id')
        .eq('organization_id', profile?.organization_id);

      setProfiles(profilesData || []);

      // Carregar últimas atribuições
      const { data: assignmentsData } = await supabase
        .from('lead_assignment')
        .select(`
          id,
          assigned_at,
          assigned_user_id,
          lead_id
        `)
        .order('assigned_at', { ascending: false })
        .limit(10);

      setRecentAssignments(assignmentsData || []);

    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const simulateLead = async () => {
    setTesting(true);
    try {
      // Buscar o primeiro pipeline ativo da organização
      const { data: pipeline, error: pipelineError } = await supabase
        .from('pipelines')
        .select('id')
        .eq('organization_id', profile?.organization_id)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (pipelineError || !pipeline) {
        throw new Error('Nenhum pipeline ativo encontrado para esta organização');
      }

      // Buscar o primeiro estágio do pipeline
      const { data: stage, error: stageError } = await supabase
        .from('pipeline_stages')
        .select('id')
        .eq('pipeline_id', pipeline.id)
        .order('position', { ascending: true })
        .limit(1)
        .single();

      if (stageError || !stage) {
        throw new Error('Nenhum estágio encontrado no pipeline');
      }

      // Criar lead de teste
      const testLead = {
        name: `Lead Teste ${new Date().toLocaleTimeString('pt-BR')}`,
        phone: `+5511${Math.floor(900000000 + Math.random() * 99999999)}`,
        email: `teste${Date.now()}@teste.com`,
        source: 'Teste Manual',
        interest: 'Simulação de rodízio',
        observations: 'Lead criado para testar distribuição automática',
        organization_id: profile?.organization_id,
        seller_id: profile?.id,
        created_by: profile?.id,
        stage_id: stage.id
      };

      const { data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert([testLead])
        .select()
        .single();

      if (leadError) throw leadError;

      // Chamar função de distribuição
      const { data: result, error: distError } = await (supabase
        .rpc as any)('distribute_lead', {
          p_lead_id: newLead.id,
          p_organization_id: profile?.organization_id
        });

      if (distError) {
        console.error('Erro na distribuição:', distError);
        throw distError;
      }

      const resultData = result as any;
      console.log('Resultado da distribuição:', resultData);

      // Buscar o nome do vendedor atribuído
      let assignedUserName = 'desconhecido';
      if (resultData?.assigned_user_id) {
        const user = profiles.find(p => p.user_id === resultData.assigned_user_id);
        assignedUserName = user?.name || 'Vendedor';
      }

      toast({
        title: "Lead distribuído!",
        description: resultData?.already_assigned 
          ? "Lead já estava atribuído"
          : `Lead atribuído para ${assignedUserName} via ${resultData?.mode || 'round-robin'}`,
      });

      // Recarregar dados
      await loadData();

    } catch (error: any) {
      console.error('Erro ao simular lead:', error);
      toast({
        title: "Erro ao simular lead",
        description: error.message || 'Erro desconhecido',
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  const resetCursor = async () => {
    try {
      await (supabase.rpc as any)('reset_distribution_cursor', {
        p_organization_id: profile?.organization_id
      });

      toast({
        title: "Cursor resetado",
        description: "A distribuição voltará ao primeiro usuário",
      });

      await loadData();
    } catch (error: any) {
      toast({
        title: "Erro ao resetar cursor",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getUserName = (userId: string) => {
    const user = profiles.find(p => p.user_id === userId);
    return user?.name || 'Usuário desconhecido';
  };

  const getNextUser = () => {
    if (!settings || !distributionUsers.length) return null;
    
    if (settings.mode === 'manual') {
      return getUserName(settings.manual_receiver_id);
    }

    const cursor = settings.rr_cursor || 0;
    const activeUsers = distributionUsers.filter(u => u.is_active);
    if (!activeUsers.length) return null;
    
    const nextIndex = cursor % activeUsers.length;
    return getUserName(activeUsers[nextIndex].user_id);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-2 text-sm text-muted-foreground">Carregando...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Estado Atual */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Estado da Distribuição
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Modo</p>
              <Badge variant={settings?.mode === 'auto' ? 'default' : 'secondary'}>
                {settings?.mode === 'manual' ? 'Manual' : 'Automático (Round-robin)'}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Próximo na fila</p>
              <p className="font-semibold">{getNextUser() || 'N/A'}</p>
            </div>
            {settings?.mode === 'auto' && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Cursor atual</p>
                <p className="font-semibold">{settings?.rr_cursor || 0}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground mb-1">Usuários ativos</p>
              <p className="font-semibold">{distributionUsers.filter(u => u.is_active).length}</p>
            </div>
          </div>

          {settings?.mode === 'auto' && distributionUsers.length > 0 && (
            <div>
              <p className="text-sm text-muted-foreground mb-2">Ordem de rodízio:</p>
              <div className="flex flex-wrap gap-2">
                {distributionUsers
                  .filter(u => u.is_active)
                  .sort((a, b) => a.order_position - b.order_position)
                  .map((user, idx) => (
                    <Badge 
                      key={user.id}
                      variant={idx === (settings.rr_cursor % distributionUsers.filter(u => u.is_active).length) ? 'default' : 'outline'}
                    >
                      {idx + 1}. {getUserName(user.user_id)}
                    </Badge>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ações */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Testar Distribuição
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Simule o recebimento de um lead via webhook para validar o rodízio
          </p>
          <div className="flex gap-2">
            <Button 
              onClick={simulateLead}
              disabled={testing || !settings?.is_auto_distribution_enabled}
              className="btn-gradient text-white"
            >
              {testing ? 'Criando lead...' : 'Simular Lead'}
            </Button>
            {settings?.mode === 'auto' && (
              <Button 
                variant="outline" 
                onClick={resetCursor}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Resetar Cursor
              </Button>
            )}
          </div>
          {!settings?.is_auto_distribution_enabled && (
            <p className="text-sm text-orange-600">
              ⚠️ Distribuição automática desabilitada. Ative nas configurações.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Últimas Atribuições */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Últimas Atribuições
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhuma atribuição ainda. Simule um lead para começar.
            </p>
          ) : (
            <div className="space-y-2">
              {recentAssignments.map((assignment, idx) => (
                <div 
                  key={assignment.id}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">#{idx + 1}</Badge>
                    <div>
                      <p className="font-medium text-sm">
                        {getUserName(assignment.assigned_user_id)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(assignment.assigned_at).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
