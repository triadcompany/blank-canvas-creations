import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface Automation {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  channel: string;
  is_active: boolean;
  flow_definition: any;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AutomationLog {
  id: string;
  automation_id: string;
  node_id: string | null;
  node_type: string | null;
  status: string;
  message: string | null;
  metadata: any;
  created_at: string;
  lead_id: string | null;
}

export function useAutomations() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();
  const { toast } = useToast();

  const fetchAutomations = useCallback(async () => {
    if (!profile?.organization_id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("automations")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching automations:", error);
    } else {
      setAutomations((data as any[]) || []);
    }
    setLoading(false);
  }, [profile?.organization_id]);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  const createAutomation = async (name: string, description?: string) => {
    if (!profile?.organization_id || !profile?.user_id) return null;
    const { data, error } = await supabase
      .from("automations")
      .insert({
        name,
        description: description || null,
        organization_id: profile.organization_id,
        created_by: profile.user_id,
        channel: "whatsapp",
        is_active: false,
        flow_definition: { nodes: [], edges: [] },
      } as any)
      .select()
      .single();

    if (error) {
      toast({ title: "Erro", description: "Falha ao criar automação", variant: "destructive" });
      return null;
    }
    toast({ title: "Sucesso", description: "Automação criada" });
    fetchAutomations();
    return data as any as Automation;
  };

  const updateAutomation = async (id: string, updates: Partial<Automation>) => {
    const { error } = await supabase
      .from("automations")
      .update(updates as any)
      .eq("id", id);

    if (error) {
      toast({ title: "Erro", description: "Falha ao atualizar automação", variant: "destructive" });
      return false;
    }
    fetchAutomations();
    return true;
  };

  const deleteAutomation = async (id: string) => {
    const { error } = await supabase
      .from("automations")
      .delete()
      .eq("id", id);

    if (error) {
      toast({ title: "Erro", description: "Falha ao excluir automação", variant: "destructive" });
      return false;
    }
    toast({ title: "Sucesso", description: "Automação excluída" });
    fetchAutomations();
    return true;
  };

  const duplicateAutomation = async (automation: Automation) => {
    if (!profile?.organization_id || !profile?.user_id) return null;
    const { data, error } = await supabase
      .from("automations")
      .insert({
        name: `${automation.name} (cópia)`,
        description: automation.description,
        organization_id: profile.organization_id,
        created_by: profile.user_id,
        channel: automation.channel,
        is_active: false,
        flow_definition: automation.flow_definition,
      } as any)
      .select()
      .single();

    if (error) {
      toast({ title: "Erro", description: "Falha ao duplicar", variant: "destructive" });
      return null;
    }
    toast({ title: "Sucesso", description: "Automação duplicada" });
    fetchAutomations();
    return data as any as Automation;
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    return updateAutomation(id, { is_active: !isActive } as any);
  };

  const fetchLogs = async (automationId: string) => {
    const { data, error } = await supabase
      .from("automation_logs")
      .select("*")
      .eq("automation_id", automationId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return [];
    return (data as any[]) as AutomationLog[];
  };

  return {
    automations,
    loading,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    duplicateAutomation,
    toggleActive,
    fetchLogs,
    refresh: fetchAutomations,
  };
}
