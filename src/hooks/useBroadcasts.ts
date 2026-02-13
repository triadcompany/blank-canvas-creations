import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface BroadcastCampaign {
  id: string;
  organization_id: string;
  created_by: string;
  name: string;
  instance_name: string;
  status: 'running' | 'paused' | 'completed' | 'canceled';
  payload_type: 'text' | 'image' | 'audio' | 'interactive';
  payload: Record<string, any>;
  buttons: any;
  settings: Record<string, any>;
  created_at: string;
  enable_automation: boolean;
  automation_id: string | null;
  response_window_hours: number;
  total?: number;
  sent?: number;
  failed?: number;
  responded?: number;
}

export interface BroadcastRecipient {
  id: string;
  campaign_id: string;
  organization_id: string;
  phone: string;
  name: string | null;
  variables: Record<string, any> | null;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
  sent_at: string | null;
  error: string | null;
  message_id: string | null;
  response_received: boolean;
  response_at: string | null;
  response_message_id: string | null;
  created_at: string;
}

export function useBroadcasts() {
  const { orgId } = useAuth();
  const queryClient = useQueryClient();

  const campaignsQuery = useQuery({
    queryKey: ['broadcasts', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('broadcast_campaigns')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Get counts per campaign
      const campaigns: BroadcastCampaign[] = [];
      for (const c of data || []) {
        const { count: total } = await supabase
          .from('broadcast_recipients')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', c.id);
        const { count: sent } = await supabase
          .from('broadcast_recipients')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', c.id)
          .eq('status', 'sent');
        const { count: failed } = await supabase
          .from('broadcast_recipients')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', c.id)
          .eq('status', 'failed');
        const { count: responded } = await supabase
          .from('broadcast_recipients')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', c.id)
          .eq('response_received', true);
        campaigns.push({
          ...c,
          status: c.status as BroadcastCampaign['status'],
          payload_type: c.payload_type as BroadcastCampaign['payload_type'],
          payload: c.payload as Record<string, any>,
          settings: c.settings as Record<string, any>,
          enable_automation: c.enable_automation || false,
          automation_id: c.automation_id || null,
          response_window_hours: c.response_window_hours || 24,
          total: total || 0,
          sent: sent || 0,
          failed: failed || 0,
          responded: responded || 0,
        });
      }
      return campaigns;
    },
  });

  const createCampaign = useMutation({
    mutationFn: async (params: {
      name: string;
      instance_name: string;
      payload_type: 'text' | 'image' | 'audio' | 'interactive';
      payload: Record<string, any>;
      settings: Record<string, any>;
      recipients: Array<{ phone: string; name?: string; variables?: Record<string, any> }>;
      profileId: string;
      enableAutomation?: boolean;
      automationId?: string | null;
      responseWindowHours?: number;
      buttons?: Array<{ label: string; value: string }> | null;
    }) => {
      // Create campaign
      const { data: campaign, error: cErr } = await supabase
        .from('broadcast_campaigns')
        .insert({
          organization_id: orgId!,
          created_by: params.profileId,
          name: params.name,
          instance_name: params.instance_name,
          payload_type: params.payload_type,
          payload: params.payload,
          settings: params.settings,
          status: 'running',
          enable_automation: params.enableAutomation || false,
          automation_id: params.automationId || null,
          response_window_hours: params.responseWindowHours || 24,
          buttons: params.buttons || null,
        } as any)
        .select('id')
        .single();
      if (cErr) throw cErr;

      // Insert recipients in batches
      const batchSize = 500;
      for (let i = 0; i < params.recipients.length; i += batchSize) {
        const batch = params.recipients.slice(i, i + batchSize).map(r => ({
          campaign_id: campaign.id,
          organization_id: orgId!,
          phone: r.phone,
          name: r.name || null,
          variables: r.variables || null,
          status: 'pending' as const,
        }));
        const { error: rErr } = await supabase
          .from('broadcast_recipients')
          .insert(batch);
        if (rErr) throw rErr;
      }

      // Trigger worker
      supabase.functions.invoke('broadcast-worker', {
        body: { campaign_id: campaign.id },
      }).catch(err => console.error('Worker trigger error:', err));

      return campaign.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
      toast.success('Campanha criada e disparos iniciados!');
    },
    onError: (err: any) => {
      toast.error('Erro ao criar campanha: ' + err.message);
    },
  });

  const updateCampaignStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('broadcast_campaigns')
        .update({ status })
        .eq('id', id);
      if (error) throw error;

      // If resuming, re-trigger worker
      if (status === 'running') {
        supabase.functions.invoke('broadcast-worker', {
          body: { campaign_id: id },
        }).catch(err => console.error('Worker trigger error:', err));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
      queryClient.invalidateQueries({ queryKey: ['broadcast-detail'] });
    },
  });

  const retryFailed = useMutation({
    mutationFn: async (campaignId: string) => {
      const { error } = await supabase
        .from('broadcast_recipients')
        .update({ status: 'pending', error: null })
        .eq('campaign_id', campaignId)
        .eq('status', 'failed');
      if (error) throw error;

      // Update campaign status back to running
      await supabase
        .from('broadcast_campaigns')
        .update({ status: 'running' })
        .eq('id', campaignId);

      // Re-trigger worker
      supabase.functions.invoke('broadcast-worker', {
        body: { campaign_id: campaignId },
      }).catch(err => console.error('Worker trigger error:', err));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
      queryClient.invalidateQueries({ queryKey: ['broadcast-detail'] });
      toast.success('Reenvio de falhas iniciado');
    },
  });

  return {
    campaigns: campaignsQuery.data || [],
    loading: campaignsQuery.isLoading,
    refetch: campaignsQuery.refetch,
    createCampaign,
    updateCampaignStatus,
    retryFailed,
  };
}

export function useBroadcastDetail(campaignId: string | undefined) {
  const { orgId } = useAuth();

  const campaignQuery = useQuery({
    queryKey: ['broadcast-detail', campaignId],
    enabled: !!campaignId && !!orgId,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('broadcast_campaigns')
        .select('*')
        .eq('id', campaignId!)
        .single();
      if (error) throw error;
      return data as unknown as BroadcastCampaign;
    },
  });

  const recipientsQuery = useQuery({
    queryKey: ['broadcast-recipients', campaignId],
    enabled: !!campaignId && !!orgId,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('broadcast_recipients')
        .select('*')
        .eq('campaign_id', campaignId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as BroadcastRecipient[];
    },
  });

  const stats = {
    total: recipientsQuery.data?.length || 0,
    sent: recipientsQuery.data?.filter(r => r.status === 'sent').length || 0,
    failed: recipientsQuery.data?.filter(r => r.status === 'failed').length || 0,
    pending: recipientsQuery.data?.filter(r => r.status === 'pending').length || 0,
    sending: recipientsQuery.data?.filter(r => r.status === 'sending').length || 0,
    responded: recipientsQuery.data?.filter(r => (r as any).response_received === true).length || 0,
  };

  return {
    campaign: campaignQuery.data,
    recipients: recipientsQuery.data || [],
    stats,
    loading: campaignQuery.isLoading,
  };
}
