import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
  const { user, orgId, switchActiveOrg } = useAuth();
  const { setActive } = useClerk();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

      // 2) Resolve org names. The canonical source for org names in this project
      //    is `clerk_organizations` (its `id` matches `org_members.organization_id`).
      //    We also look up `organizations` as a fallback for any legacy rows.
      const [{ data: clerkOrgs, error: clerkOrgErr }, { data: orgs, error: orgErr }] = await Promise.all([
        supabase.from('clerk_organizations').select('id, name').in('id', orgIds),
        supabase.from('organizations').select('id, name').in('id', orgIds),
      ]);

      if (clerkOrgErr) {
        console.error('useUserOrganizations: clerk_organizations error', clerkOrgErr);
      }
      if (orgErr) {
        console.error('useUserOrganizations: organizations error', orgErr);
      }

      const nameById = new Map<string, string>();
      (orgs || []).forEach((o: any) => {
        if (o?.id && o?.name) nameById.set(o.id as string, o.name as string);
      });
      // clerk_organizations takes precedence (matches what Clerk shows live)
      (clerkOrgs || []).forEach((o: any) => {
        if (o?.id && o?.name) nameById.set(o.id as string, o.name as string);
      });

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
        // 1) Update profiles.organization_id (this is what RLS reads).
        // We don't .select() the row back because changing organization_id
        // can momentarily intersect the SELECT policy and return null even
        // on success. We trust the absence of `error` and verify with a
        // separate SELECT below.
        const { error: profileErr } = await supabase
          .from('profiles')
          .update({ organization_id: target.organization_id })
          .eq('clerk_user_id', user.id);

        if (profileErr) {
          throw new Error(profileErr.message);
        }

        // Verify the update landed by reading back via clerk_user_id
        // (this row is always visible to the user via RLS).
        const { data: verify, error: verifyErr } = await supabase
          .from('profiles')
          .select('organization_id')
          .eq('clerk_user_id', user.id)
          .maybeSingle();

        if (verifyErr) {
          console.warn('switchOrg: verify SELECT failed (continuing anyway)', verifyErr);
        } else if (verify && verify.organization_id !== target.organization_id) {
          throw new Error('A atualização do perfil não foi confirmada pelo banco.');
        }

        // 2) Switch active Clerk organization (best-effort, non-blocking).
        // Don't await — Clerk's setActive can hang and block the redirect.
        if (target.clerk_org_id && target.clerk_org_id !== 'unknown') {
          try {
            setActive({ organization: target.clerk_org_id }).catch((err) => {
              console.warn('switchOrg: Clerk setActive failed (non-critical)', err);
            });
          } catch (err) {
            console.warn('switchOrg: Clerk setActive threw (non-critical)', err);
          }
        }

        toast({
          title: 'Organização alterada',
          description: `Você está agora em ${target.name}.`,
        });

        // 3) Force a FULL page reload. This is the only reliable way to
        // reset every in-memory cache (useAuthBootstrap.org, react-query,
        // useLeads, usePipelines, useInbox, useAutomations, etc.) so that
        // every subsequent query runs under the new organization_id.
        // Do NOT use navigate() / router.push() — those keep hooks alive
        // and the stale `org` from useAuthBootstrap would override the
        // freshly-updated profile.organization_id.
        window.location.href = '/dashboard';
      } catch (err: any) {
        toast({
          title: 'Erro ao trocar organização',
          description: err?.message || 'Tente novamente.',
          variant: 'destructive',
        });
        setSwitching(false);
      }
      // Note: don't reset `switching` on success — we want the spinner to
      // stay visible until the page reloads.
    },
    [user?.id, orgId, setActive, toast]
  );

  return { organizations, loading, switching, switchOrg, reload: load };
}
