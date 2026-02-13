import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  is_default: boolean;
  is_active: boolean;
  organization_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  position: number;
  color: string;
  is_active: boolean;
  pipeline_id: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export function usePipelines() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [ensuring, setEnsuring] = useState(false);
  const { profile, orgId: authOrgId, user } = useAuth();
  const orgId = profile?.organization_id || authOrgId;
  const clerkUserId = profile?.clerk_user_id || user?.id;
  const { toast } = useToast();

  // Ensure default pipeline exists for the org
  const ensureDefaultPipeline = useCallback(async () => {
    if (!orgId) return false;
    
    setEnsuring(true);
    try {
      const { data, error } = await supabase.rpc('ensure_default_pipeline', {
        p_org_id: orgId,
        p_created_by: clerkUserId || 'system',
      });
      
      if (error) {
        console.error('Error ensuring pipeline:', error);
        return false;
      }
      
      console.log('✅ Default pipeline ensured:', data);
      return true;
    } catch (err) {
      console.error('Exception ensuring pipeline:', err);
      return false;
    } finally {
      setEnsuring(false);
    }
  }, [orgId, clerkUserId]);

  // Fetch pipelines using RPC (bypasses RLS for Clerk)
  const fetchPipelines = useCallback(async () => {
    if (!orgId) return;

    try {
      const { data, error } = await supabase.rpc('get_org_pipelines', {
        p_org_id: orgId,
      });

      if (error) throw error;

      let pipelineList = (data || []) as Pipeline[];

      // If no pipelines, ensure default and re-fetch
      if (pipelineList.length === 0) {
        const ensured = await ensureDefaultPipeline();
        if (ensured) {
          const { data: refreshed, error: refreshError } = await supabase.rpc('get_org_pipelines', {
            p_org_id: orgId,
          });
          if (!refreshError) pipelineList = (refreshed || []) as Pipeline[];
        }
      }

      setPipelines(pipelineList);
      
      // Auto-select the default pipeline or first pipeline
      if (pipelineList.length > 0) {
        const defaultPipeline = pipelineList.find(p => p.is_default) || pipelineList[0];
        setSelectedPipeline(defaultPipeline);
      }
    } catch (error: any) {
      toast({
        title: "Erro",
        description: "Erro ao carregar pipelines",
        variant: "destructive",
      });
      console.error('Error fetching pipelines:', error);
    }
  }, [orgId, ensureDefaultPipeline, toast]);

  // Fetch stages using RPC (bypasses RLS for Clerk)
  const fetchStages = useCallback(async (pipelineId: string) => {
    try {
      const { data, error } = await supabase.rpc('get_pipeline_stages', {
        p_pipeline_id: pipelineId,
      });

      if (error) throw error;
      setStages((data || []) as PipelineStage[]);
    } catch (error: any) {
      toast({
        title: "Erro",
        description: "Erro ao carregar estágios",
        variant: "destructive",
      });
      console.error('Error fetching stages:', error);
    }
  }, [toast]);

  // Create pipeline
  const createPipeline = async (pipelineData: {
    name: string;
    description?: string;
  }) => {
    if (!orgId) {
      toast({ title: "Erro", description: "Informações de usuário não encontradas", variant: "destructive" });
      return false;
    }

    if (pipelines.length >= 10) {
      toast({ title: "Limite atingido", description: "Você pode criar no máximo 10 pipelines", variant: "destructive" });
      return false;
    }

    try {
      // If no pipelines exist yet, use the RPC to seed default pipeline first
      if (pipelines.length === 0) {
        const ensured = await ensureDefaultPipeline();
        if (ensured) {
          await fetchPipelines();
          return true;
        }
        throw new Error('Falha ao criar pipeline padrão');
      }

      const createdBy = profile?.id || clerkUserId || '';
      if (!createdBy) {
        toast({ title: "Erro", description: "Informações de usuário não encontradas", variant: "destructive" });
        return false;
      }

      const { error } = await supabase
        .from('pipelines')
        .insert({
          name: pipelineData.name,
          description: pipelineData.description,
          organization_id: orgId,
          created_by: createdBy,
          is_default: false,
        });

      if (error) throw error;

      toast({ title: "Sucesso", description: "Pipeline criado com sucesso" });
      await fetchPipelines();
      return true;
    } catch (error: any) {
      toast({ title: "Erro", description: "Erro ao criar pipeline", variant: "destructive" });
      console.error('Error creating pipeline:', error);
      return false;
    }
  };

  // Update pipeline
  const updatePipeline = async (pipelineId: string, pipelineData: { name: string; description?: string }) => {
    try {
      const { error } = await supabase.from('pipelines').update(pipelineData).eq('id', pipelineId);
      if (error) throw error;
      toast({ title: "Sucesso", description: "Pipeline atualizado com sucesso" });
      await fetchPipelines();
      return true;
    } catch (error: any) {
      toast({ title: "Erro", description: "Erro ao atualizar pipeline", variant: "destructive" });
      return false;
    }
  };

  // Delete pipeline (soft delete)
  const deletePipeline = async (pipelineId: string) => {
    if (pipelines.length <= 1) {
      toast({ title: "Erro", description: "Você deve manter pelo menos um pipeline", variant: "destructive" });
      return false;
    }
    if (stages.length > 0) {
      toast({ title: "Erro", description: "Remova todos os estágios antes de excluir o pipeline", variant: "destructive" });
      return false;
    }

    try {
      const { error } = await supabase.from('pipelines').update({ is_active: false }).eq('id', pipelineId);
      if (error) throw error;
      toast({ title: "Sucesso", description: "Pipeline excluído com sucesso" });
      await fetchPipelines();
      return true;
    } catch (error: any) {
      toast({ title: "Erro", description: "Erro ao excluir pipeline", variant: "destructive" });
      return false;
    }
  };

  // Create stage
  const createStage = async (stageData: { name: string; color: string }) => {
    if (!selectedPipeline || !profile?.id) {
      toast({ title: "Erro", description: "Pipeline ou informações do usuário não encontradas", variant: "destructive" });
      return false;
    }

    try {
      const maxPosition = Math.max(...stages.map(s => s.position), 0);
      const { error } = await supabase
        .from('pipeline_stages')
        .insert({
          name: stageData.name,
          color: stageData.color,
          position: maxPosition + 1,
          pipeline_id: selectedPipeline.id,
          created_by: profile.id,
          is_active: true,
        });

      if (error) throw error;
      toast({ title: "Sucesso", description: "Estágio criado com sucesso" });
      await fetchStages(selectedPipeline.id);
      return true;
    } catch (error: any) {
      toast({ title: "Erro", description: `Erro ao criar estágio: ${error.message || 'Erro desconhecido'}`, variant: "destructive" });
      return false;
    }
  };

  // Update stage
  const updateStage = async (stageId: string, stageData: { name: string; color: string }) => {
    try {
      const { error } = await supabase.from('pipeline_stages').update(stageData).eq('id', stageId);
      if (error) throw error;
      toast({ title: "Sucesso", description: "Estágio atualizado com sucesso" });
      if (selectedPipeline) await fetchStages(selectedPipeline.id);
      return true;
    } catch (error: any) {
      toast({ title: "Erro", description: "Erro ao atualizar estágio", variant: "destructive" });
      return false;
    }
  };

  // Delete stage (soft delete)
  const deleteStage = async (stageId: string) => {
    try {
      const { error } = await supabase.from('pipeline_stages').update({ is_active: false }).eq('id', stageId);
      if (error) throw error;
      toast({ title: "Sucesso", description: "Estágio removido com sucesso" });
      if (selectedPipeline) await fetchStages(selectedPipeline.id);
      return true;
    } catch (error: any) {
      toast({ title: "Erro", description: "Erro ao remover estágio", variant: "destructive" });
      return false;
    }
  };

  // Update stage positions
  const updateStagePositions = async (updatedStages: PipelineStage[]) => {
    if (!selectedPipeline) return;
    
    try {
      const stagesWithNewPositions = updatedStages.map((stage, index) => ({
        ...stage,
        position: index + 1
      }));
      setStages(stagesWithNewPositions);

      // Use temporary high positions first to avoid constraint violations
      for (let i = 0; i < stagesWithNewPositions.length; i++) {
        const { error } = await supabase
          .from('pipeline_stages')
          .update({ position: 1000 + i })
          .eq('id', stagesWithNewPositions[i].id);
        if (error) throw error;
      }

      // Then set final positions
      for (let i = 0; i < stagesWithNewPositions.length; i++) {
        const { error } = await supabase
          .from('pipeline_stages')
          .update({ position: i + 1 })
          .eq('id', stagesWithNewPositions[i].id);
        if (error) throw error;
      }

      toast({ title: "Sucesso", description: "Ordem dos estágios atualizada" });
    } catch (error: any) {
      toast({ title: "Erro", description: `Erro ao reordenar estágios: ${error.message}`, variant: "destructive" });
      await fetchStages(selectedPipeline.id);
    }
  };

  useEffect(() => {
    if (orgId) {
      fetchPipelines().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [orgId, clerkUserId, fetchPipelines]);

  useEffect(() => {
    if (selectedPipeline) {
      fetchStages(selectedPipeline.id);
    } else {
      setStages([]);
    }
  }, [selectedPipeline, fetchStages]);

  return {
    pipelines,
    selectedPipeline,
    setSelectedPipeline,
    stages,
    loading,
    ensuring,
    createPipeline,
    updatePipeline,
    deletePipeline,
    createStage,
    updateStage,
    deleteStage,
    updateStagePositions,
    refreshPipelines: fetchPipelines,
  };
}
