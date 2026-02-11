import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Instagram, Plus, Trash2, Users, Settings2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface InstagramConnection {
  id: string;
  instagram_username: string | null;
  page_name: string | null;
  profile_picture_url: string | null;
  is_active: boolean;
  created_at: string;
}

interface UserPermission {
  id: string;
  user_id: string;
  can_view: boolean;
  can_respond: boolean;
  can_transfer: boolean;
  profile?: {
    name: string;
    email: string;
    avatar_url: string | null;
  };
}

interface Profile {
  id: string;
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

export function InstagramSettings() {
  const { profile, isAdmin } = useAuth();
  const { toast } = useToast();
  
  const [connections, setConnections] = useState<InstagramConnection[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<InstagramConnection | null>(null);
  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [availableUsers, setAvailableUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [addUserDialogOpen, setAddUserDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  const fetchConnections = async () => {
    if (!profile?.organization_id) return;

    const { data, error } = await (supabase as any)
      .from('instagram_connections')
      .select('*')
      .eq('organization_id', profile.organization_id);

    if (!error && data) {
      setConnections(data as InstagramConnection[]);
      if (data.length > 0 && !selectedConnection) {
        setSelectedConnection(data[0] as InstagramConnection);
      }
    }
    setLoading(false);
  };

  const fetchPermissions = async () => {
    if (!selectedConnection) return;

    const { data, error } = await (supabase as any)
      .from('instagram_user_permissions')
      .select(`
        *,
        profile:profiles!instagram_user_permissions_user_id_fkey(name, email, avatar_url)
      `)
      .eq('connection_id', selectedConnection.id);

    if (!error && data) {
      setPermissions(data as UserPermission[]);
    }
  };

  const fetchAvailableUsers = async () => {
    if (!profile?.organization_id || !selectedConnection) return;

    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, user_id, name, email, avatar_url')
      .eq('organization_id', profile.organization_id);

    const { data: existingPermissions } = await (supabase as any)
      .from('instagram_user_permissions')
      .select('user_id')
      .eq('connection_id', selectedConnection.id);

    const existingUserIds = (existingPermissions || []).map((p: any) => p.user_id);
    const available = (allProfiles || []).filter(
      p => !existingUserIds.includes(p.user_id)
    );

    setAvailableUsers(available as Profile[]);
  };

  useEffect(() => {
    fetchConnections();
  }, [profile?.organization_id]);

  useEffect(() => {
    if (selectedConnection) {
      fetchPermissions();
      fetchAvailableUsers();
    }
  }, [selectedConnection]);

  const handleConnect = async () => {
    if (!profile?.id || !profile?.organization_id) {
      toast({
        title: "Erro ao conectar",
        description: "Perfil ou organização não encontrados. Faça login novamente.",
        variant: "destructive",
      });
      return;
    }

    setConnecting(true);
    try {
      const res = await fetch(
        `https://tapbwlmdvluqdgvixkxf.supabase.co/functions/v1/instagram-connect`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhcGJ3bG1kdmx1cWRndml4a3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2MDY0NDgsImV4cCI6MjA3MDE4MjQ0OH0.U2p9jneQ6Lcgu672Z8W-KnKhLgMLygDk1jB4a0YIwvQ',
          },
          body: JSON.stringify({
            action: 'get_oauth_url',
            redirectUri: `${window.location.origin}/settings?tab=instagram&callback=true`,
            profileId: profile.id,
            organizationId: profile.organization_id,
          }),
        }
      );

      let data: any;
      const rawText = await res.text();
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { raw: rawText };
      }

      console.log('[InstagramSettings] response:', { status: res.status, data });

      if (!res.ok) {
        const msg = data?.message || data?.error || rawText || 'Erro desconhecido';
        const code = data?.code || '';
        console.error('[InstagramSettings] Error details:', { status: res.status, code, data });
        toast({
          title: `Erro ao conectar (${res.status})`,
          description: `${msg}${code ? ` [${code}]` : ''}`,
          variant: "destructive",
        });
        return;
      }

      if (data?.url) {
        // Use window.open to avoid iframe restrictions (Facebook blocks X-Frame-Options)
        const opened = window.open(data.url, '_blank', 'noopener,noreferrer');
        if (!opened) {
          // Fallback: try top-level navigation if popup was blocked
          (window.top || window).location.href = data.url;
        }
      } else {
        console.error('[InstagramSettings] No URL in response:', data);
        toast({
          title: "Erro ao conectar",
          description: data?.error || "Resposta inesperada da API",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('[InstagramSettings] Network/catch error:', error);
      toast({
        title: "Erro ao conectar",
        description: error.message || "Não foi possível iniciar a conexão com o Instagram",
        variant: "destructive",
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    const { error } = await (supabase as any)
      .from('instagram_connections')
      .update({ is_active: false })
      .eq('id', connectionId);

    if (error) {
      toast({
        title: "Erro",
        description: "Não foi possível desconectar a conta",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Conta desconectada",
        description: "A conta do Instagram foi desconectada",
      });
      fetchConnections();
    }
  };

  const handleAddUser = async () => {
    if (!selectedConnection || !selectedUserId) return;

    const { error } = await (supabase as any)
      .from('instagram_user_permissions')
      .insert({
        connection_id: selectedConnection.id,
        user_id: selectedUserId,
        can_view: true,
        can_respond: true,
        can_transfer: false,
        granted_by: profile?.id,
      });

    if (error) {
      toast({
        title: "Erro",
        description: "Não foi possível adicionar o usuário",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Usuário adicionado",
        description: "O usuário agora tem acesso ao atendimento do Instagram",
      });
      setAddUserDialogOpen(false);
      setSelectedUserId('');
      fetchPermissions();
      fetchAvailableUsers();
    }
  };

  const handleUpdatePermission = async (permissionId: string, field: string, value: boolean) => {
    const { error } = await (supabase as any)
      .from('instagram_user_permissions')
      .update({ [field]: value })
      .eq('id', permissionId);

    if (error) {
      toast({
        title: "Erro",
        description: "Não foi possível atualizar a permissão",
        variant: "destructive",
      });
    } else {
      fetchPermissions();
    }
  };

  const handleRemoveUser = async (permissionId: string) => {
    const { error } = await (supabase as any)
      .from('instagram_user_permissions')
      .delete()
      .eq('id', permissionId);

    if (error) {
      toast({
        title: "Erro",
        description: "Não foi possível remover o usuário",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Usuário removido",
        description: "O usuário não tem mais acesso ao atendimento",
      });
      fetchPermissions();
      fetchAvailableUsers();
    }
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Settings2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            Apenas administradores podem gerenciar as configurações do Instagram
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-muted-foreground mt-2">Carregando...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connected accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Instagram className="h-5 w-5" />
            Contas Conectadas
          </CardTitle>
          <CardDescription>
            Gerencie as contas do Instagram conectadas à sua organização
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <div className="text-center py-8">
              <Instagram className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">
                Nenhuma conta do Instagram conectada
              </p>
              <Button onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Conectando...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Conectar Instagram
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {connections.map((connection) => (
                <div
                  key={connection.id}
                  className={`flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedConnection?.id === connection.id 
                      ? 'border-primary bg-accent/50' 
                      : 'hover:bg-accent/30'
                  }`}
                  onClick={() => setSelectedConnection(connection)}
                >
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={connection.profile_picture_url || undefined} />
                      <AvatarFallback>
                        {connection.instagram_username?.[0]?.toUpperCase() || 'IG'}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">
                        @{connection.instagram_username || 'Instagram'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {connection.page_name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={connection.is_active ? 'default' : 'secondary'}>
                      {connection.is_active ? 'Ativa' : 'Inativa'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDisconnect(connection.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}

              <Button variant="outline" onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Conectando...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Adicionar outra conta
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* User permissions */}
      {selectedConnection && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Permissões de Usuários
                </CardTitle>
                <CardDescription>
                  Gerencie quem pode acessar o atendimento da conta @{selectedConnection.instagram_username}
                </CardDescription>
              </div>
              
              <Dialog open={addUserDialogOpen} onOpenChange={setAddUserDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Adicionar Usuário
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Adicionar Usuário</DialogTitle>
                    <DialogDescription>
                      Selecione um usuário para dar acesso ao atendimento do Instagram
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um usuário" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableUsers.map((user) => (
                          <SelectItem key={user.user_id} value={user.user_id}>
                            {user.name} ({user.email})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button 
                      onClick={handleAddUser} 
                      disabled={!selectedUserId}
                      className="w-full"
                    >
                      Adicionar
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {permissions.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Nenhum usuário com permissão configurada
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead className="text-center">Visualizar</TableHead>
                    <TableHead className="text-center">Responder</TableHead>
                    <TableHead className="text-center">Transferir</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {permissions.map((permission) => (
                    <TableRow key={permission.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={permission.profile?.avatar_url || undefined} />
                            <AvatarFallback>
                              {permission.profile?.name?.[0] || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{permission.profile?.name}</p>
                            <p className="text-xs text-muted-foreground">{permission.profile?.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={permission.can_view}
                          onCheckedChange={(checked) => 
                            handleUpdatePermission(permission.id, 'can_view', checked)
                          }
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={permission.can_respond}
                          onCheckedChange={(checked) => 
                            handleUpdatePermission(permission.id, 'can_respond', checked)
                          }
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={permission.can_transfer}
                          onCheckedChange={(checked) => 
                            handleUpdatePermission(permission.id, 'can_transfer', checked)
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveUser(permission.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
