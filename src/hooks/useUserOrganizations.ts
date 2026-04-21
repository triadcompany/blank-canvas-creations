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
      // 1) Get all active memberships for this Clerk user
      const { data: memberships, error: memErr } = await supabase
        .from('org_members')
        .select('organization_id, clerk_org_id, role')
        .eq('clerk_user_id', user.id)
        .eq('status', 'active');

      if (memErr) {
        console.error('useUserOrganizations: memberships error', memErr);
        setOrganizations([]);
        return;
      }

      const orgIds = Array.from(
        new Set((memberships || []).map((m: any) => m.organization_id).filter(Boolean))
      );

      if (orgIds.length === 0) {
        setOrganizations([]);
        return;
      }

      // 2) Resolve org names in a separate query (no FK between the tables)
      const { data: orgs, error: orgErr } = await supabase
        .from('organizations')
        .select('id, name')
        .in('id', orgIds);

      if (orgErr) {
        console.error('useUserOrganizations: organizations error', orgErr);
      }

      const nameById = new Map<string, string>(
        (orgs || []).map((o: any) => [o.id as string, o.name as string])
      );

      const list: UserOrganization[] = (memberships || [])
        .filter((row: any) => row.organization_id)
        .map((row: any) => ({
          organization_id: row.organization_id,
          clerk_org_id: row.clerk_org_id,
          name: nameById.get(row.organization_id) || 'Organização',
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
