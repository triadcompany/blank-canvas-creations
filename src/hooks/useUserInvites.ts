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
      // Check for existing pending invitation
      const { data: existingInvite } = await supabase
        .from('user_invitations')
        .select('id')
        .eq('email', userData.email)
        .eq('organization_id', organizationId)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingInvite) {
        console.log('⚠️ Invite already exists, updating...');
        await supabase
          .from('user_invitations')
          .update({ name: userData.name, role: userData.role === 'admin' ? 'admin' : 'vendedor', updated_at: new Date().toISOString() })
          .eq('id', existingInvite.id);
      } else {
        // Create new invitation
        const { error: insertError } = await supabase
          .from('user_invitations')
          .insert({
            email: userData.email,
            name: userData.name,
            role: userData.role === 'admin' ? 'admin' : 'vendedor',
            organization_id: organizationId,
            invited_by: profile.id,
            status: 'pending',
          });

        if (insertError) {
          console.error('❌ Error creating invitation:', insertError);
          toast({
            title: 'Erro ao criar convite',
            description: insertError.message,
            variant: 'destructive',
          });
          return { error: insertError.message };
        }
      }

      // Send invite email via Edge Function
      try {
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
            title: 'Convite criado!',
            description: actionLink
              ? `${userData.name} foi convidado, mas o email não pôde ser enviado. Envie este link: ${actionLink}`
              : `${userData.name} foi convidado, mas houve um problema ao enviar o email.`,
            variant: 'destructive',
          });
          return { success: true, actionLink };
        }

        if (inviteResult?.success) {
          toast({
            title: 'Convite enviado!',
            description: inviteResult.message || `Convite enviado para ${userData.name} (${userData.email}).`,
          });
          return { success: true, actionLink };
        }

        toast({
          title: 'Convite criado!',
          description: `${userData.name} foi convidado, mas houve um problema: ${inviteResult?.error || 'Erro desconhecido'}`,
          variant: 'destructive',
        });
        return { success: true, actionLink };
      } catch (emailError: any) {
        console.error('❌ Erro ao enviar convite:', emailError);
        toast({
          title: 'Convite criado!',
          description: `${userData.name} foi adicionado. (Não foi possível enviar o email.)`,
          variant: 'destructive',
        });
      }

      return { success: true };
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
