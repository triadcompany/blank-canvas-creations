import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Clerk Backend API - para deletar usuário do Clerk
const CLERK_SECRET_KEY = Deno.env.get("CLERK_SECRET_KEY");

async function deleteClerkUser(clerkUserId: string): Promise<boolean> {
  if (!CLERK_SECRET_KEY) {
    console.log("⚠️ CLERK_SECRET_KEY not configured, skipping Clerk deletion");
    return true; // Continue even without Clerk deletion
  }

  try {
    const response = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok || response.status === 404) {
      console.log("✅ User deleted from Clerk (or didn't exist)");
      return true;
    }

    const errorData = await response.text();
    console.error("❌ Clerk deletion failed:", errorData);
    return false;
  } catch (error) {
    console.error("❌ Error calling Clerk API:", error);
    return false;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { profileId, clerkUserId } = await req.json();
    
    if (!profileId) {
      return new Response(
        JSON.stringify({ error: "profileId é obrigatório" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    console.log("🗑️ Deletando usuário:", { profileId, clerkUserId });

    // Verificar se o perfil existe no banco
    const { data: profile, error: profileCheckError } = await supabase
      .from('profiles')
      .select('id, clerk_user_id')
      .eq('id', profileId)
      .single();

    if (profileCheckError || !profile) {
      console.log("Perfil não encontrado:", profileCheckError);
      return new Response(
        JSON.stringify({ error: "Perfil não encontrado" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Usar clerk_user_id do profile se não foi passado
    const clerkId = clerkUserId || profile.clerk_user_id;

    // Deletar do Clerk se tiver clerk_user_id
    if (clerkId) {
      const clerkDeleted = await deleteClerkUser(clerkId);
      if (!clerkDeleted) {
        console.warn("⚠️ Failed to delete from Clerk, continuing with database deletion");
      }
    }

    // Deletar roles primeiro (evitar constraint)
    if (clerkId) {
      await supabase
        .from('user_roles')
        .delete()
        .eq('clerk_user_id', clerkId);

      // Remover membership(s) da organização — sem isso o usuário continua aparecendo
      // na listagem de "Gerenciar Usuários", que é construída a partir de org_members.
      const { error: orgMemberError } = await supabase
        .from('org_members')
        .delete()
        .eq('clerk_user_id', clerkId);

      if (orgMemberError) {
        console.warn("⚠️ Erro ao remover org_members:", orgMemberError);
      }

      // Remover users_profile (espelho do Clerk usado pelas listagens)
      const { error: usersProfileError } = await supabase
        .from('users_profile')
        .delete()
        .eq('clerk_user_id', clerkId);

      if (usersProfileError) {
        console.warn("⚠️ Erro ao remover users_profile:", usersProfileError);
      }
    }

    // Deletar o perfil do banco de dados
    const { error: profileDeleteError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', profileId);

    if (profileDeleteError) {
      console.error("Erro ao deletar perfil:", profileDeleteError);
      return new Response(
        JSON.stringify({ 
          error: "Erro ao excluir perfil do usuário",
          details: profileDeleteError.message 
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    console.log("✅ Usuário deletado com sucesso");

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Usuário excluído com sucesso" 
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );

  } catch (error: any) {
    console.error("Erro no delete-user:", error);
    return new Response(
      JSON.stringify({ 
        error: "Erro interno do servidor",
        details: error.message 
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
