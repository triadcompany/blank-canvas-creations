import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface LeadSource {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export function useLeadSources() {
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();

  const fetchLeadSources = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      console.log('🔍 Buscando origens de leads...');
      const { data, error } = await supabase
        .from('lead_sources')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      console.log('✅ Origens de leads encontradas:', data);
      setLeadSources(data || []);
    } catch (error) {
      console.error('❌ Erro ao buscar origens de leads:', error);
      toast({
        title: "Erro",
        description: "Erro ao carregar origens de leads",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return {
    leadSources,
    loading,
    refreshLeadSources: fetchLeadSources
  };
}