import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Edge, Node } from "@xyflow/react";

const SUPABASE_URL = "https://tapbwlmdvluqdgvixkxf.supabase.co";

export interface Automation {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  channel: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AutomationFlow {
  id: string;
  organization_id: string;
  automation_id: string;
  nodes: Node[];
  edges: Edge[];
  entry_node_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

async function apiCall(action: string, params: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/automations-api`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  return res.json();
}

export function useAutomations() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();
  const { toast } = useToast();

  const orgId = profile?.organization_id;

  const fetchAutomations = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const result = await apiCall("list", { organization_id: orgId });
    if (result.ok) {
      setAutomations(result.automations || []);
    } else {
      console.error("Error fetching automations:", result.message);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  const createAutomation = async (name: string, description?: string): Promise<Automation | null> => {
    if (!orgId || !profile?.id) {
      toast({ title: "Erro", description: "Usuário ou organização não encontrados", variant: "destructive" });
      return null;
    }
    const result = await apiCall("create", {
      organization_id: orgId,
      name,
      description: description || null,
      created_by: profile.id,
      channel: "whatsapp",
    });
    if (!result.ok) {
      toast({ title: "Erro ao criar automação", description: result.message, variant: "destructive" });
      return null;
    }
    toast({ title: "Sucesso", description: "Automação criada" });
    fetchAutomations();
    return result.automation;
  };

  const updateAutomation = async (id: string, updates: Partial<Automation>): Promise<boolean> => {
    const result = await apiCall("update", { id, updates });
    if (!result.ok) {
      toast({ title: "Erro", description: result.message, variant: "destructive" });
      return false;
    }
    fetchAutomations();
    return true;
  };

  const deleteAutomation = async (id: string): Promise<boolean> => {
    const result = await apiCall("delete", { id });
    if (!result.ok) {
      toast({ title: "Erro", description: result.message, variant: "destructive" });
      return false;
    }
    toast({ title: "Sucesso", description: "Automação excluída" });
    fetchAutomations();
    return true;
  };

  const duplicateAutomation = async (automation: Automation): Promise<Automation | null> => {
    if (!orgId || !profile?.id) return null;
    const result = await apiCall("duplicate", {
      id: automation.id,
      organization_id: orgId,
      created_by: profile.id,
    });
    if (!result.ok) {
      toast({ title: "Erro", description: result.message, variant: "destructive" });
      return null;
    }
    toast({ title: "Sucesso", description: "Automação duplicada" });
    fetchAutomations();
    return result.automation;
  };

  const toggleActive = async (id: string, isActive: boolean): Promise<boolean> => {
    return updateAutomation(id, { is_active: !isActive });
  };

  // ─── Flow operations ───

  const getFlow = async (automationId: string): Promise<AutomationFlow | null> => {
    const result = await apiCall("get_flow", { automation_id: automationId });
    if (result.ok && result.flow) return result.flow;
    return null;
  };

  const saveFlow = async (
    automationId: string,
    nodes: Node[],
    edges: Edge[]
  ): Promise<AutomationFlow | null> => {
    if (!orgId) return null;

    // Validate max 1 trigger
    const triggers = nodes.filter((n) => n.type === "trigger");
    if (triggers.length > 1) {
      toast({ title: "Erro", description: "Só pode haver 1 nó de gatilho por automação.", variant: "destructive" });
      return null;
    }

    const result = await apiCall("save_flow", {
      automation_id: automationId,
      organization_id: orgId,
      nodes,
      edges,
    });

    if (!result.ok) {
      toast({ title: "Erro ao salvar fluxo", description: result.message, variant: "destructive" });
      return null;
    }

    toast({ title: "Salvo", description: `Fluxo salvo (versão ${result.flow.version})` });
    return result.flow;
  };

  return {
    automations,
    loading,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    duplicateAutomation,
    toggleActive,
    getFlow,
    saveFlow,
    refresh: fetchAutomations,
  };
}
