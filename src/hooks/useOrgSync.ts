import { useEffect, useRef } from 'react';
import { useOrganization as useClerkOrganization, useUser } from '@clerk/clerk-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * useOrgSync — keeps Supabase `organizations` and `profiles` tables
 * in sync whenever the Clerk active organization or user changes.
 *
 * Runs on:
 *  a) First login (profile may not exist yet)
 *  b) Active org change in Clerk (updates organization_id on profile)
 */
export function useOrgSync() {
  const { user, isLoaded: userLoaded } = useUser();
  const { organization: clerkOrg } = useClerkOrganization();
  const { orgId, refreshProfile } = useAuth();
  const lastSyncRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userLoaded || !user || !clerkOrg) return;

    const clerkOrgId = clerkOrg.id;
    const orgName = clerkOrg.name;
    const clerkUserId = user.id;

    // Avoid duplicate syncs for the same org
    const syncKey = `${clerkUserId}:${clerkOrgId}`;
    if (lastSyncRef.current === syncKey) return;
    lastSyncRef.current = syncKey;

    const sync = async () => {
      try {
        console.log('🔄 useOrgSync: syncing org', clerkOrgId, orgName);

        // 1. Upsert clerk_organizations → get the UUID
        const { data: orgData, error: orgErr } = await supabase
          .from('clerk_organizations')
          .upsert(
            {
              clerk_org_id: clerkOrgId,
              name: orgName,
            },
            { onConflict: 'clerk_org_id' }
          )
          .select('id')
          .single();

        if (orgErr) {
          console.error('❌ useOrgSync: clerk_organizations upsert failed:', orgErr.message);
          return;
        }

        const supabaseOrgId = orgData.id;

        // 2. Upsert legacy organizations table (clerk_organization_id column if exists)
        // This is a best-effort sync for backward compat
        const { error: legacyErr } = await supabase
          .from('organizations')
          .upsert(
            {
              id: supabaseOrgId, // use same UUID for consistency
              name: orgName,
              is_active: true,
            },
            { onConflict: 'id' }
          );

        if (legacyErr) {
          console.warn('⚠️ useOrgSync: legacy organizations upsert warning:', legacyErr.message);
        }

        // 3. Ensure org_members entry exists
        const { error: memberErr } = await supabase
          .from('org_members')
          .upsert(
            {
              organization_id: supabaseOrgId,
              clerk_org_id: clerkOrgId,
              clerk_user_id: clerkUserId,
              role: 'admin',
              status: 'active',
            },
            { onConflict: 'clerk_org_id,clerk_user_id' }
          );

        if (memberErr) {
          console.warn('⚠️ useOrgSync: org_members upsert warning:', memberErr.message);
        }

        // 4. Update profile's organization_id if it doesn't match
        if (orgId !== supabaseOrgId) {
          const email = user.primaryEmailAddress?.emailAddress || '';
          const name = user.fullName || user.firstName || email.split('@')[0] || 'User';

          const { error: profileErr } = await supabase
            .from('profiles')
            .upsert(
              {
                clerk_user_id: clerkUserId,
                email,
                name,
                avatar_url: user.imageUrl || null,
                organization_id: supabaseOrgId,
                onboarding_completed: true,
              },
              { onConflict: 'clerk_user_id' }
            );

          if (profileErr) {
            console.warn('⚠️ useOrgSync: profiles upsert warning:', profileErr.message);
          }

          // Refresh auth context to pick up new orgId
          await refreshProfile();
        }

        console.log('✅ useOrgSync: sync complete, orgId:', supabaseOrgId);
      } catch (err) {
        console.error('❌ useOrgSync error:', err);
      }
    };

    sync();
  }, [userLoaded, user, clerkOrg, orgId, refreshProfile]);
}
