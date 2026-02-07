import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface Profile {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: 'admin' | 'seller';
  created_at: string;
  updated_at: string;
}

export interface UserInvitation {
  id: string;
  organization_id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'seller';
  invited_by: string | null;
  status: string | null;
  created_at: string | null;
  token: string | null;
  expires_at: string | null;
  accepted_at: string | null;
}

export function useSupabaseProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [invitations, setInvitations] = useState<UserInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const { isAdmin, user } = useAuth();
  const { toast } = useToast();

  const fetchProfiles = async () => {
    // Se não for admin, carrega apenas o próprio perfil
    if (!isAdmin) {
      if (user) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', user.id)
          .single();
        
        if (!error && data) {
          // Buscar role do usuário
          const { data: roleData } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', user.id)
            .single();
          
          setProfiles([{
            ...data,
            role: roleData?.role || 'seller'
          }]);
        }
      }
      setLoading(false);
      return;
    }

    const [profilesResult, rolesResult, invitationsResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('user_roles')
        .select('user_id, role'),
      supabase
        .from('user_invitations')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
    ]);

    if (profilesResult.error) {
      toast({
        title: "Erro",
        description: "Erro ao carregar usuários",
        variant: "destructive",
      });
    } else {
      // Merge roles with profiles
      const profilesWithRoles = (profilesResult.data || []).map(profile => ({
        ...profile,
        role: rolesResult.data?.find(r => r.user_id === profile.user_id)?.role || 'seller'
      }));
      setProfiles(profilesWithRoles);
    }

    if (invitationsResult.error) {
      toast({
        title: "Erro",
        description: "Erro ao carregar convites",
        variant: "destructive",
      });
    } else {
      setInvitations((invitationsResult.data || []) as unknown as UserInvitation[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchProfiles();
  }, [isAdmin, user]);

  const updateProfile = async (profileId: string, updates: Partial<Profile>) => {
    try {
      // Separate role from other updates
      const { role, ...profileUpdates } = updates;

      // Update profile (without role)
      if (Object.keys(profileUpdates).length > 0) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update(profileUpdates)
          .eq('id', profileId);

        if (profileError) throw profileError;
      }

      // Update role in user_roles table if provided
      if (role !== undefined) {
        const profile = profiles.find(p => p.id === profileId);
        if (profile?.user_id) {
          const { error: roleError } = await supabase
            .from('user_roles')
            .update({ role })
            .eq('user_id', profile.user_id);

          if (roleError) throw roleError;
        }
      }

      setProfiles(prev => 
        prev.map(profile => 
          profile.id === profileId 
            ? { ...profile, ...updates }
            : profile
        )
      );
      
      toast({
        title: "Sucesso",
        description: "Usuário atualizado com sucesso",
      });
    } catch (error: any) {
      toast({
        title: "Erro",
        description: "Erro ao atualizar usuário",
        variant: "destructive",
      });
    }
  };

  const deleteProfile = async (profileId: string, userId: string) => {
    try {
      // Chamar edge function para deletar usuário tanto do auth quanto do profiles
      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: {
          userId: userId,
          profileId: profileId
        }
      });

      if (error) {
        console.error("Erro ao chamar função de exclusão:", error);
        toast({
          title: "Erro",
          description: "Erro ao excluir usuário",
          variant: "destructive",
        });
        return;
      }

      // Verificar se houve erro na resposta da função
      if (data && data.error) {
        console.error("Erro retornado pela função:", data.error);
        toast({
          title: "Erro",
          description: data.error,
          variant: "destructive",
        });
        return;
      }

      // Remover do estado local apenas se a exclusão foi bem-sucedida
      setProfiles(prev => prev.filter(profile => profile.id !== profileId));
      toast({
        title: "Sucesso",
        description: "Usuário excluído com sucesso",
      });
    } catch (error) {
      console.error("Erro ao excluir usuário:", error);
      toast({
        title: "Erro",
        description: "Erro ao excluir usuário",
        variant: "destructive",
      });
    }
  };

  const deleteInvitation = async (invitationId: string) => {
    const { error } = await supabase
      .from('user_invitations')
      .delete()
      .eq('id', invitationId);

    if (error) {
      toast({
        title: "Erro",
        description: "Erro ao cancelar convite",
        variant: "destructive",
      });
    } else {
      setInvitations(prev => prev.filter(inv => inv.id !== invitationId));
      toast({
        title: "Sucesso",
        description: "Convite cancelado com sucesso",
      });
    }
  };

  return {
    profiles,
    invitations,
    loading,
    updateProfile,
    deleteProfile,
    deleteInvitation,
    refreshProfiles: fetchProfiles,
  };
}