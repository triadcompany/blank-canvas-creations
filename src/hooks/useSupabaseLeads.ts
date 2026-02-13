import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { triggerN8nWebhook } from '@/services/n8nWebhook';
import { publishAutomationEvent, AI_EVENTS } from '@/services/automationEventBus';
import { changeLeadStatus as changeLeadStatusApi, updateSaleValue } from '@/services/secureApi';

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

    // Use edge function for server-side validation
    const result = await changeLeadStatusApi(leadId, newStageId);

    if (!result.ok) {
      toast({
        title: "Erro",
        description: result.error || "Erro ao mover lead",
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

        // Publish deal.stage_changed event to Event Bus
        const traceId = crypto.randomUUID();
        publishAutomationEvent({
          organizationId: profile.organization_id,
          eventName: AI_EVENTS.DEAL_STAGE_CHANGED as any,
          entityType: 'lead',
          entityId: currentLead.id,
          leadId: currentLead.id,
          payload: {
            trace_id: traceId,
            lead_id: currentLead.id,
            phone: currentLead.phone,
            email: currentLead.email,
            lead_name: currentLead.name,
            lead_source: currentLead.source,
            lead_value: currentLead.valor_negocio || null,
            from_stage_id: currentLead.stage_id,
            from_stage_name: oldStage?.name || '',
            to_stage_id: newStageId,
            to_stage_name: newStage?.name || '',
            pipeline_id: pipelineId || '',
            changed_by_user_id: profile.id,
            occurred_at: new Date().toISOString(),
          },
          source: 'human',
          idempotencyParts: [currentLead.id, newStageId],
        }).catch(err => console.warn('[deal.stage_changed] Event publish failed:', err));
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

    // If only valor_negocio is being updated, use the secure edge function
    if (updatedData.valor_negocio !== undefined && Object.keys(updatedData).filter(k => k !== 'valor_negocio').length === 0) {
      const result = await updateSaleValue(leadId, updatedData.valor_negocio || 0);
      if (!result.ok) {
        toast({ title: "Erro", description: result.error || "Erro ao atualizar valor", variant: "destructive" });
        return;
      }
      setLeads(prevLeads => prevLeads.map(lead => lead.id === leadId ? { ...lead, ...updatedData } : lead));
      toast({ title: "Sucesso", description: "Valor atualizado com sucesso" });
      return;
    }

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
  const addLead = async (newLeadData: Omit<Lead, 'id' | 'created_at' | 'created_by' | 'stage_id'> & { stage_id?: string }) => {
    if (!profile) return;

    // Use the stage_id passed from the modal, or fall back to the first stage
    const stageId = (newLeadData as any).stage_id || stages.find(s => s.position === 1)?.id;
    if (!stageId) return;

    // Remove stage_id from spread to avoid type conflict
    const { stage_id: _, ...restData } = newLeadData as any;

    const leadData = {
      ...restData,
      seller_id: (newLeadData as any).seller_id || profile.id,
      created_by: profile.id,
      stage_id: stageId,
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

    // Fire automation trigger (non-blocking)
    if (profile.organization_id) {
      const finalLead = updatedLead || data;
      fetch("https://tapbwlmdvluqdgvixkxf.supabase.co/functions/v1/automation-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: profile.organization_id,
          trigger_type: "lead_created",
          entity_type: "lead",
          entity_id: finalLead.id,
          context: {
            lead_name: finalLead.name,
            lead_phone: finalLead.phone,
            lead_email: finalLead.email,
            lead_source: finalLead.source,
            stage_name: finalLead.stage?.name || '',
            stage_id: finalLead.stage_id,
            seller_id: finalLead.seller_id,
          },
        }),
      }).catch((err) => console.error("Automation trigger error:", err));
    }
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