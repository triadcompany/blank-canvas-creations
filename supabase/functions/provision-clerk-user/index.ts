import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "https://deno.land/x/jose@v5.2.0/index.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ClerkJWTPayload {
  sub: string;
  email?: string;
  name?: string;
  exp: number;
  iat: number;
  iss: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get the Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Get Clerk JWKS URL from the issuer
    const clerkIssuer = Deno.env.get('CLERK_JWT_ISSUER');
    if (!clerkIssuer) {
      console.error('CLERK_JWT_ISSUER not configured');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the JWT using Clerk's JWKS
    const jwksUrl = `${clerkIssuer}/.well-known/jwks.json`;
    const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));

    let payload: ClerkJWTPayload;
    try {
      const { payload: verifiedPayload } = await jose.jwtVerify(token, JWKS, {
        issuer: clerkIssuer,
      });
      payload = verifiedPayload as unknown as ClerkJWTPayload;
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError);
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clerkUserId = payload.sub;
    const email = payload.email || '';
    const name = payload.name || email.split('@')[0] || 'User';

    console.log('Provisioning user:', { clerkUserId, email, name });

    // Create Supabase admin client (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Check if profile already exists
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle();

    if (existingProfile) {
      console.log('Profile already exists:', existingProfile.id);
      
      // Get the role
      const { data: roleData } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('clerk_user_id', clerkUserId)
        .maybeSingle();

      return new Response(
        JSON.stringify({ 
          success: true, 
          profile: existingProfile,
          role: roleData?.role || null,
          message: 'Profile already exists' 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create new organization
    const { data: newOrg, error: orgError } = await supabaseAdmin
      .from('organizations')
      .insert({ name: `${name}'s Organization` })
      .select('id')
      .single();

    if (orgError) {
      console.error('Error creating organization:', orgError);
      return new Response(
        JSON.stringify({ error: 'Failed to create organization', details: orgError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Organization created:', newOrg.id);

    // Create profile
    const { data: newProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        clerk_user_id: clerkUserId,
        email: email,
        name: name,
        organization_id: newOrg.id,
        user_id: clerkUserId, // Use clerk ID as user_id for compatibility
      })
      .select()
      .single();

    if (profileError) {
      console.error('Error creating profile:', profileError);
      // Rollback organization
      await supabaseAdmin.from('organizations').delete().eq('id', newOrg.id);
      return new Response(
        JSON.stringify({ error: 'Failed to create profile', details: profileError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Profile created:', newProfile.id);

    // Create admin role for new user
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        clerk_user_id: clerkUserId,
        user_id: clerkUserId,
        organization_id: newOrg.id,
        role: 'admin',
      });

    if (roleError) {
      console.error('Error creating role:', roleError);
      // Don't fail completely, profile is created
    } else {
      console.log('Role created: admin');
    }

    // Create default pipeline for the organization
    const defaultStages = [
      { name: 'Novo Lead', order_position: 0 },
      { name: 'Contato Inicial', order_position: 1 },
      { name: 'Qualificação', order_position: 2 },
      { name: 'Proposta', order_position: 3 },
      { name: 'Negociação', order_position: 4 },
      { name: 'Fechamento', order_position: 5 },
      { name: 'Ganho', order_position: 6 },
      { name: 'Perdido', order_position: 7 },
    ];

    const { data: pipeline, error: pipelineError } = await supabaseAdmin
      .from('pipelines')
      .insert({
        name: 'Pipeline Principal',
        organization_id: newOrg.id,
        is_default: true,
      })
      .select('id')
      .single();

    if (!pipelineError && pipeline) {
      const stagesToInsert = defaultStages.map(stage => ({
        ...stage,
        pipeline_id: pipeline.id,
      }));

      await supabaseAdmin.from('pipeline_stages').insert(stagesToInsert);
      console.log('Default pipeline created');
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        profile: newProfile,
        role: 'admin',
        message: 'Profile created successfully' 
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
