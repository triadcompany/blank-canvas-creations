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

      // 2. Upsert profile (may already exist from a previous attempt)
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle();

      if (existingProfile) {
        // Update existing profile with the new org
        const { error: updateError } = await supabase
          .from("profiles")
          .update({ organization_id: newOrg.id })
          .eq("clerk_user_id", clerkUserId);

        if (updateError) {
          await supabase.from("organizations").delete().eq("id", newOrg.id);
          throw new Error("Erro ao atualizar perfil: " + updateError.message);
        }
        console.log("✅ Profile updated with new org");
      } else {
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
          await supabase.from("organizations").delete().eq("id", newOrg.id);
          throw new Error("Erro ao criar perfil: " + profileError.message);
        }
        console.log("✅ Profile created");
      }

      // 3. Create admin role
      await supabase.from("user_roles").insert({
        clerk_user_id: clerkUserId,
        organization_id: newOrg.id,
        role: "admin",
      });

      console.log("✅ Admin role created");

      // 4. Create default lead sources
      const defaultSources = ["Meta Ads", "Google Ads", "Orgânico", "Site", "Indicação"];
      const { error: sourcesError } = await supabase
        .from("lead_sources")
        .insert(
          defaultSources.map((name) => ({
            name,
            organization_id: newOrg.id,
            created_by: clerkUserId,
            is_active: true,
          }))
        );

      if (sourcesError) {
        console.warn("⚠️ Lead sources seed error (non-critical):", sourcesError);
      } else {
        console.log("✅ Default lead sources created");
      }

      // 5. Create default pipeline via idempotent seed function
      const { data: pipelineId, error: seedError } = await supabase.rpc('seed_default_pipeline', {
        p_org_id: newOrg.id,
        p_created_by: clerkUserId,
      });

      if (seedError) {
        console.warn("⚠️ Pipeline seed error (non-critical):", seedError);
      } else {
        console.log("✅ Default pipeline created:", pipelineId);
      }

      // 6. Create default "Boas-vindas Lead" automation
      try {
        const supabaseUrl = "https://tapbwlmdvluqdgvixkxf.supabase.co";
        const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhcGJ3bG1kdmx1cWRndml4a3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2MDY0NDgsImV4cCI6MjA3MDE4MjQ0OH0.U2p9jneQ6Lcgu672Z8W-KnKhLgMLygDk1jB4a0YIwvQ";

        // Create automation
        const createRes = await fetch(`${supabaseUrl}/functions/v1/automations-api`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify({
            action: "create",
            organization_id: newOrg.id,
            name: "Boas-vindas Lead",
            description: "Envia mensagem de boas-vindas automaticamente para novos leads",
            created_by: clerkUserId,
            channel: "whatsapp",
          }),
        });
        const createData = await createRes.json();

        if (createData.ok && createData.automation) {
          // Save flow with trigger → delay → message
          const nodes = [
            {
              id: "trigger_1",
              type: "trigger",
              position: { x: 250, y: 50 },
              data: { label: "Novo Lead", config: { triggerType: "lead_created" } },
            },
            {
              id: "delay_1",
              type: "delay",
              position: { x: 250, y: 200 },
              data: { label: "Esperar 1 min", config: { amount: 1, unit: "minutes" } },
            },
            {
              id: "message_1",
              type: "message",
              position: { x: 250, y: 350 },
              data: {
                label: "Boas-vindas",
                config: { text: "Olá {{lead.name}}, vi seu interesse. Posso te ajudar?" },
              },
            },
          ];
          const edges = [
            { id: "e_trigger_delay", source: "trigger_1", target: "delay_1" },
            { id: "e_delay_message", source: "delay_1", target: "message_1" },
          ];

          await fetch(`${supabaseUrl}/functions/v1/automations-api`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
            body: JSON.stringify({
              action: "save_flow",
              automation_id: createData.automation.id,
              organization_id: newOrg.id,
              nodes,
              edges,
            }),
          });
          console.log("✅ Default automation created");
        }
      } catch (autoErr) {
        console.warn("⚠️ Default automation error (non-critical):", autoErr);
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
