import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
};

interface ClerkUserData {
  id: string;
  email_addresses: Array<{ email_address: string; id: string }>;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
  public_metadata: {
    organization_id?: string;
    role?: 'admin' | 'seller';
  };
  private_metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserData;
  object: string;
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔔 Clerk webhook received');

    // Verify the webhook signature using Svix
    const svixId = req.headers.get('svix-id');
    const svixTimestamp = req.headers.get('svix-timestamp');
    const svixSignature = req.headers.get('svix-signature');

    if (!svixId || !svixTimestamp || !svixSignature) {
      console.error('❌ Missing Svix headers');
      return new Response(
        JSON.stringify({ error: 'Missing webhook signature headers' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // Get the webhook secret from environment
    const webhookSecret = Deno.env.get('CLERK_WEBHOOK_SECRET');
    if (!webhookSecret) {
      console.error('❌ CLERK_WEBHOOK_SECRET not configured');
      return new Response(
        JSON.stringify({ error: 'Webhook secret not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // Parse the webhook payload
    const payload = await req.text();
    
    // For now, we'll skip signature verification and parse the event directly
    // In production, you should verify the signature using the Svix library
    // TODO: Add proper signature verification with svix package
    
    const evt: ClerkWebhookEvent = JSON.parse(payload);
    console.log('📦 Webhook event type:', evt.type);
    console.log('📦 Webhook data:', JSON.stringify(evt.data, null, 2));

    // Create Supabase client with service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const userData = evt.data;
    const primaryEmail = userData.email_addresses?.[0]?.email_address;
    const fullName = [userData.first_name, userData.last_name].filter(Boolean).join(' ') || primaryEmail?.split('@')[0] || 'User';

    if (evt.type === 'user.created') {
      console.log('👤 Creating new user profile for:', userData.id);

      // Check if organization_id is provided in metadata
      let organizationId = userData.public_metadata?.organization_id;
      
      // If no organization, create a new one
      if (!organizationId) {
        console.log('🏢 No organization provided, creating new one...');
        
        const { data: newOrg, error: orgError } = await supabase
          .from('organizations')
          .insert({ name: `${fullName}'s Organization` })
          .select('id')
          .single();

        if (orgError) {
          console.error('❌ Error creating organization:', orgError);
          return new Response(
            JSON.stringify({ error: 'Failed to create organization' }),
            { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        organizationId = newOrg.id;
        console.log('✅ Organization created:', organizationId);
      }

      // Create profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .insert({
          clerk_user_id: userData.id,
          email: primaryEmail,
          name: fullName,
          organization_id: organizationId,
          avatar_url: userData.image_url,
        })
        .select()
        .single();

      if (profileError) {
        console.error('❌ Error creating profile:', profileError);
        return new Response(
          JSON.stringify({ error: 'Failed to create profile' }),
          { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      console.log('✅ Profile created:', profile.id);

      // Create user role
      const role = userData.public_metadata?.role || 'admin'; // Default to admin for new signups
      
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({
          clerk_user_id: userData.id,
          role: role,
        });

      if (roleError) {
        console.error('❌ Error creating role:', roleError);
        // Don't fail the whole request, role can be added later
      } else {
        console.log('✅ Role created:', role);
      }

      // Create default pipeline stages for new organization (if new org was created)
      if (!userData.public_metadata?.organization_id) {
        const defaultStages = [
          { name: 'Novo Lead', order_index: 0, organization_id: organizationId, color: '#3B82F6' },
          { name: 'Contato Inicial', order_index: 1, organization_id: organizationId, color: '#8B5CF6' },
          { name: 'Qualificação', order_index: 2, organization_id: organizationId, color: '#F59E0B' },
          { name: 'Proposta Enviada', order_index: 3, organization_id: organizationId, color: '#10B981' },
          { name: 'Negociação', order_index: 4, organization_id: organizationId, color: '#EC4899' },
          { name: 'Fechado Ganho', order_index: 5, organization_id: organizationId, color: '#22C55E' },
          { name: 'Fechado Perdido', order_index: 6, organization_id: organizationId, color: '#EF4444' },
          { name: 'Arquivado', order_index: 7, organization_id: organizationId, color: '#6B7280' },
        ];

        const { error: stagesError } = await supabase
          .from('pipeline_stages')
          .insert(defaultStages);

        if (stagesError) {
          console.error('❌ Error creating pipeline stages:', stagesError);
        } else {
          console.log('✅ Default pipeline stages created');
        }
      }

      return new Response(
        JSON.stringify({ success: true, message: 'User created successfully' }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    if (evt.type === 'user.updated') {
      console.log('📝 Updating user profile for:', userData.id);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          email: primaryEmail,
          name: fullName,
          avatar_url: userData.image_url,
          updated_at: new Date().toISOString(),
        })
        .eq('clerk_user_id', userData.id);

      if (updateError) {
        console.error('❌ Error updating profile:', updateError);
        return new Response(
          JSON.stringify({ error: 'Failed to update profile' }),
          { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      console.log('✅ Profile updated successfully');

      return new Response(
        JSON.stringify({ success: true, message: 'User updated successfully' }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    if (evt.type === 'user.deleted') {
      console.log('🗑️ Deleting user profile for:', userData.id);

      // Delete role first
      await supabase
        .from('user_roles')
        .delete()
        .eq('clerk_user_id', userData.id);

      // Delete profile (cascade should handle related data)
      const { error: deleteError } = await supabase
        .from('profiles')
        .delete()
        .eq('clerk_user_id', userData.id);

      if (deleteError) {
        console.error('❌ Error deleting profile:', deleteError);
        return new Response(
          JSON.stringify({ error: 'Failed to delete profile' }),
          { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      console.log('✅ Profile deleted successfully');

      return new Response(
        JSON.stringify({ success: true, message: 'User deleted successfully' }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // Unknown event type
    console.log('ℹ️ Unhandled event type:', evt.type);
    return new Response(
      JSON.stringify({ success: true, message: 'Event acknowledged' }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );

  } catch (error: any) {
    console.error('💥 Unexpected error in sync-clerk-user:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
};

serve(handler);
