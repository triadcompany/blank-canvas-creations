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
  const { user } = useAuth();
  const { toast } = useToast();

  const inviteUser = async (userData: InviteUserData): Promise<InviteUserResult> => {
    console.log('🔥 inviteUser called with:', userData);
    if (!user) {
      console.error('❌ No user authenticated');
      toast({
        title: 'Erro',
        description: 'Usuário não autenticado',
        variant: 'destructive',
      });
      return { error: 'Usuário não autenticado' };
    }

    console.log('✅ User authenticated:', user.id);
    setLoading(true);

    try {
      console.log('🚀 Calling create_user_in_organization...');
      // Criar usuário diretamente na organização
      const { data, error } = await (supabase.rpc as any)('create_user_in_organization', {
        p_email: userData.email,
        p_name: userData.name,
        p_role: userData.role,
      });

      console.log('📡 RPC Response:', { data, error });

      if (error) {
        toast({
          title: 'Erro ao criar usuário',
          description: error.message,
          variant: 'destructive',
        });
        return { error: error.message };
      }

      if (data && typeof data === 'object' && 'error' in data) {
        const errorMessage = data.error as string;
        toast({
          title: 'Erro ao criar usuário',
          description: errorMessage,
          variant: 'destructive',
        });
        return { error: errorMessage };
      }

      // Enviar convite por email usando Edge Function
      try {
        console.log('📧 Enviando convite via Edge Function...');

        const { data: inviteResult, error: inviteError } = await supabase.functions.invoke('invite-user', {
          body: {
            email: userData.email,
            name: userData.name,
            role: userData.role,
          },
        });

        const actionLink = inviteResult?.actionLink as string | undefined;

        if (inviteError) {
          console.error('❌ Erro ao chamar Edge Function:', inviteError);
          toast({
            title: 'Usuário criado!',
            description:
              actionLink
                ? `${userData.name} foi adicionado, mas o email não pôde ser enviado. Envie este link por WhatsApp para ele criar a senha: ${actionLink}`
                : `${userData.name} foi adicionado, mas houve um problema ao enviar o email.`,
            variant: 'destructive',
          });
          return { success: true, data, actionLink };
        }

        if (inviteResult?.success) {
          toast({
            title: 'Convite pronto!',
            description:
              actionLink
                ? `Se o email não chegar, envie este link para ${userData.email}: ${actionLink}`
                : inviteResult.message || `Convite gerado para ${userData.name} (${userData.email}).`,
          });
          return { success: true, data, actionLink };
        }

        console.error('❌ Erro no resultado:', inviteResult);
        toast({
          title: 'Usuário criado!',
          description:
            actionLink
              ? `O usuário foi adicionado, mas houve um problema. Envie este link para ele criar a senha: ${actionLink}`
              : `${userData.name} foi adicionado, mas houve um problema: ${inviteResult?.error || 'Erro desconhecido'}`,
          variant: 'destructive',
        });

        return { success: true, data, actionLink };
      } catch (emailError: any) {
        console.error('❌ Erro ao enviar convite:', emailError);
        toast({
          title: 'Usuário criado!',
          description: `${userData.name} foi adicionado. (Não foi possível gerar/entregar o link automaticamente.)`,
          variant: 'destructive',
        });
      }

      return { success: true, data };
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