import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export default function Onboarding() {
  const { user } = useUser();
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user || !companyName.trim()) return;

    setIsCreating(true);

    try {
      const clerkUserId = user.id;
      const email = user.primaryEmailAddress?.emailAddress || "";
      const name = user.fullName || user.firstName || email.split("@")[0] || "Usuário";
      const avatarUrl = user.imageUrl || undefined;

      console.log("🏢 Creating organization:", companyName);

      // 1. Create organization
      const { data: newOrg, error: orgError } = await supabase
        .from("organizations")
        .insert({
          name: companyName.trim(),
          cnpj: cnpj.trim() || null,
          is_active: true,
        })
        .select("id")
        .single();

      if (orgError) {
        throw new Error("Erro ao criar organização: " + orgError.message);
      }

      console.log("✅ Organization created:", newOrg.id);

      // 2. Create profile
      const { error: profileError } = await supabase
        .from("profiles")
        .insert({
          clerk_user_id: clerkUserId,
          email,
          name,
          avatar_url: avatarUrl,
          organization_id: newOrg.id,
        });

      if (profileError) {
        // Rollback organization
        await supabase.from("organizations").delete().eq("id", newOrg.id);
        throw new Error("Erro ao criar perfil: " + profileError.message);
      }

      console.log("✅ Profile created");

      // 3. Create admin role
      await supabase.from("user_roles").insert({
        clerk_user_id: clerkUserId,
        organization_id: newOrg.id,
        role: "admin",
      });

      console.log("✅ Admin role created");

      // 4. Create default pipeline via idempotent seed function
      const { data: pipelineId, error: seedError } = await supabase.rpc('seed_default_pipeline', {
        p_org_id: newOrg.id,
        p_created_by: clerkUserId,
      });

      if (seedError) {
        console.warn("⚠️ Pipeline seed error (non-critical):", seedError);
      } else {
        console.log("✅ Default pipeline created:", pipelineId);
      }

      toast.success("Empresa criada com sucesso!", {
        description: `Bem-vindo ao AutoLead, ${name}!`,
      });

      // Refresh profile and navigate
      await refreshProfile();
      navigate("/", { replace: true });

    } catch (error) {
      console.error("❌ Error creating organization:", error);
      toast.error("Erro ao criar empresa", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <Card className="w-full max-w-md border-border/50 shadow-xl">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center">
            <Building2 className="w-8 h-8 text-primary" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">
              Bem-vindo ao AutoLead!
            </CardTitle>
            <CardDescription className="mt-2">
              Para começar, informe o nome da sua empresa ou negócio.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateOrganization} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="company-name" className="text-sm font-medium">
                Nome da Empresa
              </Label>
              <Input
                id="company-name"
                type="text"
                placeholder="Ex: Minha Empresa LTDA"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                disabled={isCreating}
                className="h-12"
                autoFocus
                required
                minLength={2}
                maxLength={100}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cnpj" className="text-sm font-medium">
                CNPJ <span className="text-muted-foreground font-normal">(opcional)</span>
              </Label>
              <Input
                id="cnpj"
                type="text"
                placeholder="00.000.000/0000-00"
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                disabled={isCreating}
                className="h-12"
                maxLength={18}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Você poderá alterar isso depois nas configurações.
            </p>

            <Button
              type="submit"
              className="w-full h-12 text-base font-medium"
              disabled={isCreating || !companyName.trim()}
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Criando...
                </>
              ) : (
                <>
                  Começar a usar
                  <ArrowRight className="ml-2 h-5 w-5" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
