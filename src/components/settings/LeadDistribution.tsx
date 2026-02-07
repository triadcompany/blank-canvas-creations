import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Users, Trash2, Settings, UserPlus, RefreshCw } from 'lucide-react';
import { useLeadDistribution, LeadDistributionRule } from '@/hooks/useLeadDistribution';
import { useSupabaseProfiles } from '@/hooks/useSupabaseProfiles';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';

const LeadDistribution: React.FC = () => {
  const {
    settings,
    users: distributionUsers,
    loading,
    createOrUpdateSettings,
    addDistributionUser,
    removeDistributionUser,
    resetCursor,
  } = useLeadDistribution();

  const { profiles } = useSupabaseProfiles();

  const [isAutoEnabled, setIsAutoEnabled] = useState(false);
  const [distributionMode, setDistributionMode] = useState<'manual' | 'auto'>('manual');
  const [manualReceiverId, setManualReceiverId] = useState<string>('');
  const [showAddUser, setShowAddUser] = useState(false);


  useEffect(() => {
    if (settings) {
      setIsAutoEnabled(settings.is_auto_distribution_enabled);
      setDistributionMode(settings.mode);
      setManualReceiverId(settings.manual_receiver_id || '');
    }
  }, [settings]);

  const handleSaveSettings = async () => {
    try {
      await createOrUpdateSettings({
        is_auto_distribution_enabled: isAutoEnabled,
        mode: distributionMode,
        manual_receiver_id: distributionMode === 'manual' ? manualReceiverId : undefined,
      });
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };


  const handleAddDistributionUser = async (userAuthId: string) => {
    try {
      const nextPosition = distributionUsers.length + 1;
      await addDistributionUser(userAuthId, nextPosition);
      setShowAddUser(false);
    } catch (error) {
      console.error('Error adding user to distribution:', error);
    }
  };

  const getUserName = (userId: string) => {
    const user = profiles.find(p => p.user_id === userId);
    return user?.name || 'Usuário não encontrado';
  };

  const getNextUserInQueue = () => {
    if (!settings || distributionUsers.length === 0) return null;
    const nextIndex = settings.rr_cursor % distributionUsers.length;
    const nextUser = distributionUsers[nextIndex];
    return nextUser ? getUserName(nextUser.user_id) : null;
  };

  const availableUsers = profiles.filter(
    profile => !distributionUsers.some(du => du.user_id === profile.user_id)
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Configurações Gerais */}
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
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>Distribuição Automática</Label>
              <p className="text-sm text-muted-foreground">
                Quando ativada, os leads serão distribuídos automaticamente conforme as regras configuradas
              </p>
            </div>
            <Switch
              checked={isAutoEnabled}
              onCheckedChange={setIsAutoEnabled}
            />
          </div>

          {isAutoEnabled && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Modo de Distribuição</Label>
                <Select value={distributionMode} onValueChange={(value: any) => setDistributionMode(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="auto">Automático (Round Robin)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  {distributionMode === 'manual' 
                    ? 'Um usuário receptor manual receberá todos os leads para distribuir manualmente'
                    : 'Leads serão distribuídos automaticamente em rodízio entre os usuários selecionados'}
                </p>
              </div>

              {distributionMode === 'manual' && (
                <div className="space-y-2">
                  <Label>Usuário Receptor Manual</Label>
                  <Select value={manualReceiverId} onValueChange={setManualReceiverId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um usuário" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((user) => (
                        <SelectItem key={user.user_id} value={user.user_id}>
                          {user.name} - {user.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    Todos os leads do WhatsApp serão direcionados para este usuário fazer a distribuição manual
                  </p>
                </div>
              )}

              <Button onClick={handleSaveSettings} className="w-full">
                Salvar Configurações
              </Button>
            </div>
          )}
        </CardContent>
      </Card>


      {/* Usuários na Distribuição */}
      {isAutoEnabled && distributionMode === 'auto' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Usuários na Distribuição
            </CardTitle>
            <CardDescription>
              Configure quais usuários participam do rodízio de distribuição de leads. 
              {getNextUserInQueue() && (
                <span className="block mt-2">
                  <strong>Próximo na fila:</strong> {getNextUserInQueue()}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {distributionUsers.length > 0 && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={resetCursor}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Resetar Cursor
                </Button>
              </div>
            )}
            <div className="grid gap-4">
              {distributionUsers.map((user, index) => (
                <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">#{index + 1}</Badge>
                    <span className="font-medium">{getUserName(user.user_id)}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeDistributionUser(user.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {availableUsers.length > 0 && (
              <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Adicionar Usuário ao Rodízio
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Adicionar Usuário</DialogTitle>
                    <DialogDescription>
                      Selecione um usuário para adicionar ao rodízio de distribuição
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4">
                    {availableUsers.map((profile) => (
                      <Button
                        key={profile.id}
                        variant="outline"
                        className="justify-start"
                        onClick={() => handleAddDistributionUser(profile.user_id)}
                      >
                        <UserPlus className="h-4 w-4 mr-2" />
                        {profile.name} - {profile.role}
                      </Button>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default LeadDistribution;