import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { triggerN8nWebhook } from '@/services/n8nWebhook';

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  seller_id: string;
  source: string;
  interest: string;
  price?: string;
  observations: string;
  stage_id: string;
  created_at: string;
  created_by: string;
  // Campos financeiros e de localização
  valor_negocio?: number;
  servico?: string;
  cidade?: string;
  estado?: string;
  // Joined data
  seller_name?: string;
  stage_name?: string;
  stage_position?: number;
}

export interface PipelineStage {
  id: string;
  name: string;
  position: number;
  color: string;
  is_active: boolean;
}

export interface KanbanColumn {
  id: string;
  title: string;
  leads: Lead[];
  color: string;
  count: number;
  position: number;
}

export function useSupabaseLeads(pipelineId?: string) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const { profile, isAdmin } = useAuth();
  const { toast } = useToast();

  // Fetch pipeline stages
  const fetchStages = async () => {
    if (!profile?.organization_id) {
      setStages([]);
      return;
    }

    // Se não tem pipelineId, busca o pipeline padrão via RPC
    let activePipelineId = pipelineId;
    
    if (!activePipelineId) {
      const { data: orgPipelines } = await supabase.rpc('get_org_pipelines', {
        p_org_id: profile.organization_id,
      });
      
      const pipelineList = (orgPipelines || []) as any[];
      let defaultPipeline = pipelineList.find((p: any) => p.is_default) || pipelineList[0];
      
      if (!defaultPipeline) {
        // Tentar seed idempotente
        if (profile.clerk_user_id) {
          const { data: seededId } = await supabase.rpc('ensure_default_pipeline', {
            p_org_id: profile.organization_id,
            p_created_by: profile.clerk_user_id,
          });
          activePipelineId = seededId;
        }
      } else {
        activePipelineId = defaultPipeline.id;
      }
    }

    if (!activePipelineId) {
      setStages([]);
      return;
    }

    // Fetch stages via RPC
    const { data, error } = await supabase.rpc('get_pipeline_stages', {
      p_pipeline_id: activePipelineId,
    });

    if (error) {
      toast({
        title: "Erro",
        description: "Erro ao carregar etapas do pipeline",
        variant: "destructive",
      });
    } else {
      setStages((data || []) as PipelineStage[]);
    }
  };

  // Fetch leads
  const fetchLeads = async () => {
    if (!profile) {
      console.log('❌ useSupabaseLeads: No profile, skipping fetch');
      return;
    }
    
    console.log('🔍 useSupabaseLeads: Fetching leads...', { 
      isAdmin, 
      profileId: profile.id,
      organizationId: profile.organization_id 
    });
    
    let query = supabase
      .from('leads')
      .select(`
        *,
        seller:profiles!seller_id(name),
        stage:pipeline_stages!stage_id(name, position, color)
      `);

    // If not admin, only show own leads
    if (!isAdmin) {
      query = query.eq('seller_id', profile.id);
      console.log('👤 useSupabaseLeads: Filtering by seller_id:', profile.id);
    } else {
      // Admin vê todos os leads da organização
      query = query.eq('organization_id', profile.organization_id);
      console.log('👑 useSupabaseLeads: Admin - Fetching all leads from org:', profile.organization_id);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('❌ useSupabaseLeads: Error fetching leads:', error);
      toast({
        title: "Erro",
        description: "Erro ao carregar leads",
        variant: "destructive",
      });
    } else {
      console.log(`✅ useSupabaseLeads: Fetched ${data?.length || 0} leads`);
      const formattedLeads = data?.map(lead => ({
        ...lead,
        seller_name: lead.seller?.name,
        stage_name: lead.stage?.name,
        stage_position: lead.stage?.position,
      })) || [];
      setLeads(formattedLeads);
    }
  };

  useEffect(() => {
    if (profile) {
      Promise.all([fetchStages(), fetchLeads()]).finally(() => setLoading(false));
    }
  }, [profile, isAdmin, pipelineId]);

  // Filter leads based on search term
  const getFilteredLeads = (): Lead[] => {
    if (!searchTerm.trim()) return leads;
    const term = searchTerm.toLowerCase();
    return leads.filter(lead => 
      lead.name.toLowerCase().includes(term) ||
      lead.phone.toLowerCase().includes(term) ||
      (lead.email && lead.email.toLowerCase().includes(term)) ||
      (lead.interest && lead.interest.toLowerCase().includes(term)) ||
      (lead.observations && lead.observations.toLowerCase().includes(term))
    );
  };

  // Get kanban columns with filtered leads
  const getKanbanColumns = (): KanbanColumn[] => {
    const filteredLeads = getFilteredLeads();
    return stages.map(stage => {
      const stageLeads = filteredLeads.filter(lead => lead.stage_id === stage.id);
      return {
        id: stage.id,
        title: stage.name,
        leads: stageLeads,
        color: stage.color,
        count: stageLeads.length,
        position: stage.position
      };
    }).sort((a, b) => a.position - b.position);
  };

  // Move lead to different stage
  const moveLead = async (leadId: string, newStageId: string) => {
    if (!profile) return;

    // Buscar lead atual e estágio antigo para o webhook
    const currentLead = leads.find(l => l.id === leadId);
    const oldStage = stages.find(s => s.id === currentLead?.stage_id);
    const newStage = stages.find(s => s.id === newStageId);

    const { error } = await supabase
      .from('leads')
      .update({ 
        stage_id: newStageId
      })
      .eq('id', leadId);

    if (error) {
      toast({
        title: "Erro",
        description: "Erro ao mover lead",
        variant: "destructive",
      });
    } else {
      // Update local state
      setLeads(prevLeads =>
        prevLeads.map(lead =>
          lead.id === leadId
            ? { ...lead, stage_id: newStageId, stage_name: newStage?.name }
            : lead
        )
      );
      toast({
        title: "Sucesso",
        description: "Lead movido com sucesso",
      });

      // Disparar webhook n8n se configurado
      if (currentLead && profile.organization_id) {
        triggerN8nWebhook(
          profile.organization_id,
          {
            id: currentLead.id,
            name: currentLead.name,
            email: currentLead.email,
            phone: currentLead.phone,
            source: currentLead.source,
            interest: currentLead.interest,
            observations: currentLead.observations
          },
          {
            from: oldStage?.name || 'Desconhecido',
            to: newStage?.name || 'Desconhecido',
            fromId: currentLead.stage_id,
            toId: newStageId
          }
        );
      }
    }
  };

  // Update lead
  const updateLead = async (leadId: string, updatedData: Partial<Lead>) => {
    if (!profile || !leadId) {
      toast({
        title: "Erro",
        description: "Dados inválidos para atualização",
        variant: "destructive",
      });
      return;
    }

    console.log('Updating lead:', leadId, 'with data:', updatedData);

    // Ensure organization_id is included and remove any undefined values
    const cleanUpdateData = Object.fromEntries(
      Object.entries({
        ...updatedData,
        organization_id: profile.organization_id
      }).filter(([_, value]) => value !== undefined && value !== "")
    );

    console.log('Clean update data:', cleanUpdateData);

    const { error } = await supabase
      .from('leads')
      .update(cleanUpdateData)
      .eq('id', leadId);

    if (error) {
      console.error('Error updating lead:', error);
      toast({
        title: "Erro",
        description: `Erro ao atualizar lead: ${error.message}`,
        variant: "destructive",
      });
    } else {
      // Update local state
      setLeads(prevLeads =>
        prevLeads.map(lead =>
          lead.id === leadId
            ? { ...lead, ...updatedData }
            : lead
        )
      );
      toast({
        title: "Sucesso",
        description: "Lead atualizado com sucesso",
      });
    }
  };

  // Add new lead
  const addLead = async (newLeadData: Omit<Lead, 'id' | 'created_at' | 'created_by' | 'stage_id'>) => {
    if (!profile) return;

    // Get first stage as default
    const firstStage = stages.find(s => s.position === 1);
    if (!firstStage) return;

    const leadData = {
      ...newLeadData,
      seller_id: profile.id, // Temporário - será atualizado pela distribuição
      created_by: profile.id,
      stage_id: firstStage.id,
      organization_id: profile.organization_id,
    };

    const { data, error } = await supabase
      .from('leads')
      .insert(leadData)
      .select(`
        *,
        seller:profiles!seller_id(name),
        stage:pipeline_stages!stage_id(name, position, color)
      `)
      .single();

    if (error) {
      toast({
        title: "Erro",
        description: "Erro ao criar lead",
        variant: "destructive",
      });
      return;
    }

    // Chamar distribuição automática
    try {
      const { error: distributionError } = await (supabase.rpc as any)('distribute_lead', {
        p_lead_id: data.id,
        p_organization_id: profile.organization_id
      });

      if (distributionError) {
        console.error('Error distributing lead:', distributionError);
        // Não falhar a criação do lead se a distribuição falhar
      } else {
        console.log('Lead distributed successfully');
      }
    } catch (err) {
      console.error('Exception during lead distribution:', err);
    }

    // Buscar lead atualizado com o seller correto após distribuição
    const { data: updatedLead } = await supabase
      .from('leads')
      .select(`
        *,
        seller:profiles!seller_id(name),
        stage:pipeline_stages!stage_id(name, position, color)
      `)
      .eq('id', data.id)
      .single();

    const formattedLead = {
      ...(updatedLead || data),
      seller_name: updatedLead?.seller?.name || data.seller?.name,
      stage_name: updatedLead?.stage?.name || data.stage?.name,
      stage_position: updatedLead?.stage?.position || data.stage?.position,
    };
    
    setLeads(prevLeads => [formattedLead, ...prevLeads]);
    toast({
      title: "Sucesso",
      description: "Lead criado e distribuído com sucesso",
    });
  };

  // Delete lead (admin only)
  const deleteLead = async (leadId: string) => {
    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', leadId);

    if (error) {
      console.error('Error deleting lead:', error);
      toast({
        title: "Erro",
        description: error.message || "Erro ao excluir lead. Verifique suas permissões.",
        variant: "destructive",
      });
    } else {
      // Update local state
      setLeads(prevLeads => prevLeads.filter(lead => lead.id !== leadId));
      toast({
        title: "Sucesso",
        description: "Lead excluído com sucesso",
      });
    }
  };

  return {
    leads,
    stages,
    loading,
    searchTerm,
    setSearchTerm,
    kanbanColumns: getKanbanColumns(),
    moveLead,
    updateLead,
    addLead,
    deleteLead,
    refreshLeads: fetchLeads,
  };
}