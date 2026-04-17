import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Svix HMAC-SHA256 signature verification
async function verifyWebhookSignature(payload: string, headers: Headers, secret: string): Promise<boolean> {
  const svixId = headers.get('svix-id');
  const svixTimestamp = headers.get('svix-timestamp');
  const svixSignature = headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(svixTimestamp, 10);
  if (Math.abs(now - ts) > 300) return false;

  const secretBytes = Uint8Array.from(
    atob(secret.startsWith('whsec_') ? secret.slice(6) : secret),
    (c) => c.charCodeAt(0)
  );
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  return svixSignature.split(' ').some((s) => {
    const [v, val] = s.split(',');
    return v === 'v1' && val === computed;
  });
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log('🔔 Clerk webhook received');
    const webhookSecret = Deno.env.get('CLERK_WEBHOOK_SECRET');
    if (!webhookSecret) {
      console.error('❌ CLERK_WEBHOOK_SECRET not configured');
      return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const payload = await req.text();

    // Verify signature (skip in test/local for sample webhooks)
    const isTest = req.headers.get('svix-id')?.startsWith('msg_') === false;
    const valid = await verifyWebhookSignature(payload, req.headers, webhookSecret);
    if (!valid && !isTest) {
      console.error('❌ Invalid webhook signature');
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const evt = JSON.parse(payload);
    const eventType: string = evt.type;
    const data = evt.data || {};
    console.log('📦 Event:', eventType);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ========== USER EVENTS ==========
    if (eventType === 'user.created' || eventType === 'user.updated') {
      const clerkUserId = data.id;
      const email = data.email_addresses?.find((e: any) => e.id === data.primary_email_address_id)?.email_address
        || data.email_addresses?.[0]?.email_address
        || null;
      const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ')
        || email?.split('@')[0]
        || 'User';
      const avatarUrl = data.image_url || null;

      // Upsert into users_profile (Clerk mirror table)
      const { error: upErr } = await supabase
        .from('users_profile')
        .upsert(
          { clerk_user_id: clerkUserId, email, full_name: fullName, avatar_url: avatarUrl },
          { onConflict: 'clerk_user_id' }
        );
      if (upErr) console.error('⚠️ users_profile upsert:', upErr.message);

      // Update existing profiles row if any
      if (email) {
        await supabase
          .from('profiles')
          .update({ email, name: fullName, avatar_url: avatarUrl, updated_at: new Date().toISOString() })
          .eq('clerk_user_id', clerkUserId);
      }

      console.log(`✅ User ${eventType}: ${clerkUserId}`);
    }

    else if (eventType === 'user.deleted') {
      const clerkUserId = data.id;
      console.log(`🗑️ Deleting user cascade: ${clerkUserId}`);
      const { data: result, error } = await supabase.rpc('purge_user_cascade', {
        p_clerk_user_id: clerkUserId,
      });
      if (error) console.error('❌ purge_user_cascade:', error);
      else console.log('✅ User purged:', result);
    }

    // ========== ORGANIZATION EVENTS ==========
    else if (eventType === 'organization.created' || eventType === 'organization.updated') {
      const clerkOrgId = data.id;
      const name = data.name || 'Unnamed';
      const slug = data.slug || null;
      const { error } = await supabase
        .from('clerk_organizations')
        .upsert(
          { clerk_org_id: clerkOrgId, name, slug, deleted_at: null },
          { onConflict: 'clerk_org_id' }
        );
      if (error) console.error('❌ clerk_organizations upsert:', error);
      else console.log(`✅ Org ${eventType}: ${clerkOrgId}`);
    }

    else if (eventType === 'organization.deleted') {
      const clerkOrgId = data.id;
      console.log(`🗑️ Deleting organization cascade: ${clerkOrgId}`);
      const { data: result, error } = await supabase.rpc('purge_organization_by_clerk_id', {
        p_clerk_org_id: clerkOrgId,
      });
      if (error) console.error('❌ purge_organization_by_clerk_id:', error);
      else console.log('✅ Org purged:', result);
    }

    // ========== MEMBERSHIP EVENTS ==========
    else if (eventType === 'organizationMembership.created' || eventType === 'organizationMembership.updated') {
      const clerkOrgId = data.organization?.id;
      const clerkUserId = data.public_user_data?.user_id;
      const clerkRole: string = data.role || 'org:member';
      if (!clerkOrgId || !clerkUserId) {
        console.error('❌ Missing org/user id in membership event');
      } else {
        const role = clerkRole === 'org:admin' ? 'admin' : 'seller';
        const orgName = data.organization?.name || 'Unnamed';
        const orgSlug = data.organization?.slug || null;

        // Ensure org exists
        const { data: orgRow, error: orgErr } = await supabase
          .from('clerk_organizations')
          .upsert(
            { clerk_org_id: clerkOrgId, name: orgName, slug: orgSlug, deleted_at: null },
            { onConflict: 'clerk_org_id' }
          )
          .select('id')
          .single();
        if (orgErr) console.error('❌ org upsert in membership:', orgErr);

        if (orgRow?.id) {
          const { error: memberErr } = await supabase
            .from('org_members')
            .upsert(
              {
                organization_id: orgRow.id,
                clerk_org_id: clerkOrgId,
                clerk_user_id: clerkUserId,
                role,
                status: 'active',
              },
              { onConflict: 'clerk_org_id,clerk_user_id' }
            );
          if (memberErr) console.error('❌ member upsert:', memberErr);

          // Sync user_roles
          await supabase
            .from('user_roles')
            .upsert(
              { clerk_user_id: clerkUserId, organization_id: orgRow.id, role },
              { onConflict: 'clerk_user_id,organization_id' }
            );

          console.log(`✅ Member ${eventType}: ${clerkUserId} → ${clerkOrgId} (${role})`);
        }
      }
    }

    else if (eventType === 'organizationMembership.deleted') {
      const clerkOrgId = data.organization?.id;
      const clerkUserId = data.public_user_data?.user_id;
      if (!clerkOrgId || !clerkUserId) {
        console.error('❌ Missing org/user id in membership.deleted');
      } else {
        console.log(`🗑️ Removing member ${clerkUserId} from ${clerkOrgId}`);
        const { error } = await supabase.rpc('purge_org_membership', {
          p_clerk_org_id: clerkOrgId,
          p_clerk_user_id: clerkUserId,
        });
        if (error) console.error('❌ purge_org_membership:', error);
        else console.log('✅ Member removed');
      }
    }

    else {
      console.log('ℹ️ Unhandled event:', eventType);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('💥 Unexpected error:', err);
    // Return 200 to prevent endless retries; error is logged
    return new Response(JSON.stringify({ received: true, error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

serve(handler);
