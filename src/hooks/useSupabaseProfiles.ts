import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface Profile {
  id: string;
  user_id: string;
  clerk_user_id?: string;
  name: string;
  email: string;
  avatar_url?: string | null;
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
  const { isAdmin, user, profile: currentProfile, orgId: authOrgId } = useAuth();
  const { toast } = useToast();

  const fetchProfiles = async () => {
    const organizationId = currentProfile?.organization_id || authOrgId;

    // Se não tiver organization_id, não pode listar ninguém
    if (!organizationId) {
      setProfiles([]);
      setInvitations([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('get_org_profiles_with_roles', {
        p_org_id: organizationId,
      });

      if (error) {
        console.error('Error fetching profiles via RPC:', error);
        toast({
          title: "Erro",
          description: "Erro ao carregar usuários",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const result = data as any;

      // Build profiles with roles
      const profilesList = result?.profiles || [];
      const rolesList = result?.roles || [];

      // Always return all org members so dropdowns (vendedor responsável, etc.) work for everyone
      const profilesWithRoles = profilesList.map((profile: any) => ({
        ...profile,
        role: rolesList.find((r: any) => r.clerk_user_id === profile.clerk_user_id)?.role || 'seller',
      }));
      setProfiles(profilesWithRoles);
      // Invitations only relevant for admins (used in user management UI)
      if (isAdmin) {
        setInvitations((result?.invitations || []) as unknown as UserInvitation[]);
      }
    } catch (err) {
      console.error('Error in fetchProfiles:', err);
      toast({
        title: "Erro",
        description: "Erro ao carregar usuários",
        variant: "destructive",
      });
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchProfiles();
  }, [isAdmin, user, currentProfile?.organization_id, authOrgId]);

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

  const deleteProfile = async (profileId: string, clerkUserId?: string) => {
    // Find the actual clerk_user_id from the profile if not provided or if user_id was passed instead
    const profileObj = profiles.find(p => p.id === profileId);
    const resolvedClerkUserId = profileObj?.clerk_user_id || clerkUserId || profileObj?.user_id;
    try {
      // Chamar edge function para deletar usuário tanto do Clerk quanto do profiles
      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: {
          clerkUserId: resolvedClerkUserId,
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