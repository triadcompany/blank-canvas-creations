import { useState, useEffect } from 'react';
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
  const { profile } = useAuth();
  const { toast } = useToast();

  // Fetch pipelines
  const fetchPipelines = async () => {
    try {
      const { data, error } = await supabase
        .from('pipelines')
        .select('*')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;

      setPipelines(data || []);
      
      // Auto-select the default pipeline or first pipeline
      if (data && data.length > 0) {
        const defaultPipeline = data.find(p => p.is_default) || data[0];
        setSelectedPipeline(defaultPipeline);
      } else {
        // Se não há pipelines, talvez seja um novo usuário - tentar novamente após delay
        setTimeout(() => {
          fetchPipelines();
        }, 1000);
      }
    } catch (error: any) {
      toast({
        title: "Erro",
        description: "Erro ao carregar pipelines",
        variant: "destructive",
      });
      console.error('Error fetching pipelines:', error);
    }
  };

  // Fetch stages for selected pipeline
  const fetchStages = async (pipelineId: string) => {
    try {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .eq('is_active', true)
        .order('position');

      if (error) throw error;
      setStages(data || []);
    } catch (error: any) {
      toast({
        title: "Erro",
        description: "Erro ao carregar estágios",
        variant: "destructive",
      });
      console.error('Error fetching stages:', error);
    }
  };

  // Create pipeline
  const createPipeline = async (pipelineData: {
    name: string;
    description?: string;
  }) => {
    if (!profile?.organization_id || !profile?.id) {
      toast({
        title: "Erro",
        description: "Informações de usuário não encontradas",
        variant: "destructive",
      });
      return false;
    }

    // Check if user already has 10 pipelines
    if (pipelines.length >= 10) {
      toast({
        title: "Limite atingido",
        description: "Você pode criar no máximo 10 pipelines",
        variant: "destructive",
      });
      return false;
    }

    try {
      const { data, error } = await supabase
        .from('pipelines')
        .insert({
          name: pipelineData.name,
          description: pipelineData.description,
          organization_id: profile.organization_id,
          created_by: profile.id,
          is_default: pipelines.length === 0, // First pipeline is default
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: "Pipeline criado com sucesso",
      });

      await fetchPipelines();
      return true;
    } catch (error: any) {
      toast({
        title: "Erro",
        description: "Erro ao criar pipeline",
        variant: "destructive",
      });
      console.error('Error creating pipeline:', error);
      return false;
    }
  };

  // Update pipeline
  const updatePipeline = async (pipelineId: string, pipelineData: {
    name: string;
    description?: string;
  }) => {
    try {
      const { error } = await supabase
        .from('pipelines')
        .update(pipelineData)
        .eq('id', pipelineId);

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: "Pipeline atualizado com sucesso",
      });

      await fetchPipelines();
      return true;
    } catch (error: any) {
      toast({
        title: "Erro",
        description: "Erro ao atualizar pipeline",
        variant: "destructive",
      });
      console.error('Error updating pipeline:', error);
      return false;
    }
  };

  // Delete pipeline
  const deletePipeline = async (pipelineId: string) => {
    try {
      // Don't allow deleting the last pipeline
      if (pipelines.length <= 1) {
        toast({
          title: "Erro",
          description: "Você deve manter pelo menos um pipeline",
          variant: "destructive",
        });
        return false;
      }

      // Don't allow deleting if it has stages
      if (stages.length > 0) {
        toast({
          title: "Erro",
          description: "Remova todos os estágios antes de excluir o pipeline",
          variant: "destructive",
        });
        return false;
      }

      const { error } = await supabase
        .from('pipelines')
        .update({ is_active: false })
        .eq('id', pipelineId);

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: "Pipeline excluído com sucesso",
      });

      await fetchPipelines();
      return true;
    } catch (error: any) {
      toast({
        title: "Erro",
        description: "Erro ao excluir pipeline",
        variant: "destructive",
      });
      console.error('Error deleting pipeline:', error);
      return false;
    }
  };

  // Create stage
  const createStage = async (stageData: {
    name: string;
    color: string;
  }) => {
    if (!selectedPipeline || !profile?.id) {
      toast({
        title: "Erro",
        description: "Pipeline ou informações do usuário não encontradas",
        variant: "destructive",
      });
      return false;
    }

    try {
      const maxPosition = Math.max(...stages.map(s => s.position), 0);
      const { data, error } = await supabase
        .from('pipeline_stages')
        .insert({
          name: stageData.name,
          color: stageData.color,
          position: maxPosition + 1,
          pipeline_id: selectedPipeline.id,
          created_by: profile.id,
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating stage:', error);
        throw error;
      }

      toast({
        title: "Sucesso",
        description: "Estágio criado com sucesso",
      });

      await fetchStages(selectedPipeline.id);
      return true;
    } catch (error: any) {
      toast({
        title: "Erro",
        description: `Erro ao criar estágio: ${error.message || 'Erro desconhecido'}`,
        variant: "destructive",
      });
      console.error('Error creating stage:', error);
      return false;
    }
  };

  // Update stage
  const updateStage = async (stageId: string, stageData: {
    name: string;
    color: string;
  }) => {
    try {
      const { error } = await supabase
        .from('pipeline_stages')
        .update(stageData)
        .eq('id', stageId);

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: "Estágio atualizado com sucesso",
      });

      if (selectedPipeline) {
        await fetchStages(selectedPipeline.id);
      }
      return true;
    } catch (error: any) {
      toast({
        title: "Erro",
        description: "Erro ao atualizar estágio",
        variant: "destructive",
      });
      console.error('Error updating stage:', error);
      return false;
    }
  };

  // Delete stage
  const deleteStage = async (stageId: string) => {
    try {
      const { error } = await supabase
        .from('pipeline_stages')
        .update({ is_active: false })
        .eq('id', stageId);

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: "Estágio removido com sucesso",
      });

      if (selectedPipeline) {
        await fetchStages(selectedPipeline.id);
      }
      return true;
    } catch (error: any) {
      toast({
        title: "Erro",
        description: "Erro ao remover estágio",
        variant: "destructive",
      });
      console.error('Error deleting stage:', error);
      return false;
    }
  };

  // Update stage positions
  const updateStagePositions = async (updatedStages: PipelineStage[]) => {
    if (!selectedPipeline) return;
    
    try {
      // Update local state immediately for instant feedback
      const stagesWithNewPositions = updatedStages.map((stage, index) => ({
        ...stage,
        position: index + 1
      }));
      setStages(stagesWithNewPositions);

      // Use temporary high positions first to avoid constraint violations
      for (let i = 0; i < stagesWithNewPositions.length; i++) {
        const stage = stagesWithNewPositions[i];
        const tempPosition = 1000 + i;
        
        const { error: tempError } = await supabase
          .from('pipeline_stages')
          .update({ position: tempPosition })
          .eq('id', stage.id);
        
        if (tempError) throw tempError;
      }

      // Then update to final positions
      for (let i = 0; i < stagesWithNewPositions.length; i++) {
        const stage = stagesWithNewPositions[i];
        const { error } = await supabase
          .from('pipeline_stages')
          .update({ position: i + 1 })
          .eq('id', stage.id);
        
        if (error) throw error;
      }

      toast({
        title: "Sucesso",
        description: "Ordem dos estágios atualizada",
      });
    } catch (error: any) {
      toast({
        title: "Erro",
        description: `Erro ao reordenar estágios: ${error.message}`,
        variant: "destructive",
      });
      console.error('Error updating stage positions:', error);
      
      // Revert to original order on error
      await fetchStages(selectedPipeline.id);
    }
  };

  useEffect(() => {
    fetchPipelines().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedPipeline) {
      fetchStages(selectedPipeline.id);
    } else {
      setStages([]);
    }
  }, [selectedPipeline]);

  return {
    pipelines,
    selectedPipeline,
    setSelectedPipeline,
    stages,
    loading,
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