import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface InviteUserData {
  email: string;
  name: string;
  role: 'admin' | 'seller';
}

type InviteUserResult = { error?: string; success?: boolean; data?: any; actionLink?: string };

export function useUserInvites() {
  const [loading, setLoading] = useState(false);
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const inviteUser = async (userData: InviteUserData): Promise<InviteUserResult> => {
    console.log('🔥 inviteUser called with:', userData);
    if (!user || !profile) {
      console.error('❌ No user/profile');
      toast({
        title: 'Erro',
        description: 'Usuário não autenticado ou perfil não encontrado',
        variant: 'destructive',
      });
      return { error: 'Usuário não autenticado' };
    }

    const organizationId = profile.organization_id;
    if (!organizationId) {
      toast({
        title: 'Erro',
        description: 'Você não pertence a nenhuma organização',
        variant: 'destructive',
      });
      return { error: 'Sem organização' };
    }

    console.log('✅ User authenticated, org:', organizationId);
    setLoading(true);

    try {
      // Edge function handles both invitation creation and email sending using service role
      console.log('📧 Enviando convite via Edge Function...');

      const { data: inviteResult, error: inviteError } = await supabase.functions.invoke('invite-user', {
        body: {
          email: userData.email,
          name: userData.name,
          role: userData.role,
          organizationId,
        },
      });

      const actionLink = inviteResult?.signUpUrl as string | undefined;

      if (inviteError) {
        console.error('❌ Erro ao chamar Edge Function:', inviteError);
        toast({
          title: 'Erro ao criar convite',
          description: inviteResult?.error || inviteError.message || 'Erro ao enviar convite',
          variant: 'destructive',
        });
        return { error: inviteError.message, actionLink };
      }

      if (inviteResult?.success) {
        toast({
          title: 'Convite enviado!',
          description: inviteResult.message || `Convite enviado para ${userData.name} (${userData.email}).`,
        });
        return { success: true, actionLink };
      }

      toast({
        title: 'Erro ao criar convite',
        description: inviteResult?.error || 'Erro desconhecido',
        variant: 'destructive',
      });
      return { error: inviteResult?.error, actionLink };
    } catch (error: any) {
      toast({
        title: 'Erro inesperado',
        description: error.message || 'Ocorreu um erro ao enviar o convite',
        variant: 'destructive',
      });
      return { error: error.message };
    } finally {
      setLoading(false);
    }
  };

  return {
    inviteUser,
    loading,
  };
}
