import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClerk } from '@clerk/clerk-react';
import { useToast } from '@/hooks/use-toast';

export interface UserOrganization {
  organization_id: string;
  clerk_org_id: string | null;
  name: string;
  role: 'admin' | 'seller';
  is_current: boolean;
}

/**
 * Lists every organization the logged-in user belongs to (via org_members)
 * and exposes a switchOrg() helper that updates profiles.organization_id and
 * the active Clerk organization, then reloads the app context.
 */
export function useUserOrganizations() {
  const { user, orgId, refreshProfile } = useAuth();
  const { setActive } = useClerk();
  const { toast } = useToast();
  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) {
      setOrganizations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('org_members')
        .select('organization_id, clerk_org_id, role, organizations(name)')
        .eq('clerk_user_id', user.id)
        .eq('status', 'active');

      if (error) {
        console.error('useUserOrganizations: load error', error);
        setOrganizations([]);
        return;
      }

      const list: UserOrganization[] = (data || [])
        .filter((row: any) => row.organization_id && row.organizations?.name)
        .map((row: any) => ({
          organization_id: row.organization_id,
          clerk_org_id: row.clerk_org_id,
          name: row.organizations.name as string,
          role: (row.role === 'admin' ? 'admin' : 'seller') as 'admin' | 'seller',
          is_current: row.organization_id === orgId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setOrganizations(list);
    } finally {
      setLoading(false);
    }
  }, [user?.id, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const switchOrg = useCallback(
    async (target: UserOrganization) => {
      if (!user?.id) return;
      if (target.organization_id === orgId) return;
      setSwitching(true);
      try {
        // 1) Update profiles.organization_id (this is what RLS reads)
        const { error: profileErr } = await supabase
          .from('profiles')
          .update({ organization_id: target.organization_id })
          .eq('clerk_user_id', user.id);

        if (profileErr) {
          throw new Error(profileErr.message);
        }

        // 2) Switch active Clerk organization (best-effort, non-blocking)
        if (target.clerk_org_id && target.clerk_org_id !== 'unknown') {
          try {
            await setActive({ organization: target.clerk_org_id });
          } catch (err) {
            console.warn('switchOrg: Clerk setActive failed (non-critical)', err);
          }
        }

        toast({
          title: 'Organização alterada',
          description: `Você está agora em ${target.name}.`,
        });

        // 3) Force a full reload so every cached query (leads, pipeline, inbox)
        // refetches under the new organization_id.
        await refreshProfile();
        window.location.assign('/dashboard');
      } catch (err: any) {
        toast({
          title: 'Erro ao trocar organização',
          description: err?.message || 'Tente novamente.',
          variant: 'destructive',
        });
      } finally {
        setSwitching(false);
      }
    },
    [user?.id, orgId, setActive, refreshProfile, toast]
  );

  return { organizations, loading, switching, switchOrg, reload: load };
}
