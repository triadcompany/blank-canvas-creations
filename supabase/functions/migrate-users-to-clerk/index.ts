import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface ClerkUserResponse {
  id: string;
  email_addresses: Array<{ email_address: string }>;
  first_name: string | null;
  last_name: string | null;
}

async function createClerkUser(email: string, firstName: string, lastName: string, metadata: Record<string, any>): Promise<ClerkUserResponse | null> {
  try {
    const response = await fetch('https://api.clerk.com/v1/users', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${clerkSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: [email],
        first_name: firstName,
        last_name: lastName,
        public_metadata: metadata,
        skip_password_requirement: true, // Usuário precisará definir senha
      }),
    });

    if (response.status === 422) {
      // Usuário já existe no Clerk
      const errorData = await response.json();
      console.log(`⚠️ User ${email} already exists in Clerk:`, errorData);
      
      // Buscar usuário existente
      const searchResponse = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, {
        headers: {
          'Authorization': `Bearer ${clerkSecretKey}`,
        },
      });
      
      if (searchResponse.ok) {
        const users = await searchResponse.json();
        if (users.length > 0) {
          return users[0];
        }
      }
      return null;
    }

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`❌ Failed to create Clerk user for ${email}:`, errorData);
      return null;
    }

    const user = await response.json();
    console.log(`✅ Created Clerk user for ${email}:`, user.id);
    return user;
  } catch (error) {
    console.error(`❌ Error creating Clerk user for ${email}:`, error);
    return null;
  }
}

async function sendPasswordResetEmail(clerkUserId: string): Promise<boolean> {
  try {
    // Clerk não tem API direta para enviar reset, mas podemos usar o magic link
    // O usuário precisará clicar em "Forgot Password" no login
    console.log(`ℹ️ User ${clerkUserId} will need to use "Forgot Password" to set their password`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending reset email:`, error);
    return false;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🚀 Starting user migration from Supabase Auth to Clerk");

    if (!clerkSecretKey) {
      return new Response(
        JSON.stringify({ success: false, error: "CLERK_SECRET_KEY not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Buscar todos os profiles que ainda não têm clerk_user_id
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, user_id, name, email, organization_id')
      .is('clerk_user_id', null);

    if (profilesError) {
      console.error("❌ Error fetching profiles:", profilesError);
      return new Response(
        JSON.stringify({ success: false, error: profilesError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!profiles || profiles.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No users to migrate",
          migrated: 0,
          skipped: 0,
          failed: 0
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 Found ${profiles.length} users to migrate`);

    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    const results: Array<{ email: string; status: string; clerkId?: string }> = [];

    for (const profile of profiles) {
      console.log(`\n🔄 Processing: ${profile.email}`);

      // Buscar role do usuário
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', profile.user_id)
        .single();

      const role = roleData?.role || 'seller';

      // Separar nome em first/last name
      const nameParts = (profile.name || 'User').split(' ');
      const firstName = nameParts[0] || 'User';
      const lastName = nameParts.slice(1).join(' ') || '';

      // Criar usuário no Clerk
      const clerkUser = await createClerkUser(
        profile.email,
        firstName,
        lastName,
        {
          organization_id: profile.organization_id,
          role: role,
          supabase_user_id: profile.user_id,
        }
      );

      if (!clerkUser) {
        failed++;
        results.push({ email: profile.email, status: 'failed' });
        continue;
      }

      // Atualizar profile com clerk_user_id
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ clerk_user_id: clerkUser.id })
        .eq('id', profile.id);

      if (updateError) {
        console.error(`❌ Failed to update profile for ${profile.email}:`, updateError);
        failed++;
        results.push({ email: profile.email, status: 'failed', clerkId: clerkUser.id });
        continue;
      }

      // Atualizar user_roles com clerk_user_id
      await supabase
        .from('user_roles')
        .update({ clerk_user_id: clerkUser.id })
        .eq('user_id', profile.user_id);

      migrated++;
      results.push({ email: profile.email, status: 'migrated', clerkId: clerkUser.id });
      console.log(`✅ Successfully migrated: ${profile.email} -> ${clerkUser.id}`);
    }

    console.log(`\n📊 Migration complete: ${migrated} migrated, ${skipped} skipped, ${failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Migration complete`,
        migrated,
        skipped,
        failed,
        results,
        note: "Migrated users will need to use 'Forgot Password' to set their password in Clerk"
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("❌ Migration error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
