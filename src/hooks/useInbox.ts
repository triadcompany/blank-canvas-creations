import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface InboxThread {
  id: string;
  organization_id: string;
  instance_name: string;
  contact_phone: string;
  contact_name: string | null;
  contact_name_source: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  created_at: string;
  profile_picture_url: string | null;
  profile_picture_updated_at: string | null;
  lead_id: string | null;
  lead_stage_name?: string | null;
  ai_mode: string;
}

export interface InboxMessage {
  id: string;
  organization_id: string;
  conversation_id: string;
  direction: string;
  body: string;
  external_message_id: string | null;
  created_at: string;
}

export interface OrgMember {
  id: string;
  name: string;
}

type FilterMode = 'all' | 'mine' | 'unassigned';

export function useInbox() {
  const { profile, role, isAdmin } = useAuth();
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>(isAdmin ? 'all' : 'mine');
  const [search, setSearch] = useState('');
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);

  const orgId = profile?.organization_id;
  const myProfileId = profile?.id;

  // Fetch org members for assignment dropdown
  const fetchOrgMembers = useCallback(async () => {
    if (!orgId) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name')
        .eq('organization_id', orgId)
        .order('name');
      if (error) throw error;
      setOrgMembers((data as OrgMember[]) || []);
    } catch (err) {
      console.error('Error fetching org members:', err);
    }
  }, [orgId]);

  useEffect(() => {
    fetchOrgMembers();
  }, [fetchOrgMembers]);

  // Fetch conversations with lead info
  const fetchThreads = useCallback(async () => {
    if (!orgId) return;
    setLoadingThreads(true);

    try {
      let query = supabase
        .from('conversations')
        .select('*, lead:leads!lead_id(id, stage_id, stage:pipeline_stages!stage_id(name))')
        .eq('organization_id', orgId)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (filter === 'mine' && myProfileId) {
        query = query.eq('assigned_to', myProfileId);
      } else if (filter === 'unassigned') {
        query = query.is('assigned_to', null);
      }

      if (search.trim()) {
        query = query.or(`contact_phone.ilike.%${search}%,contact_name.ilike.%${search}%`);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;

      const mapped = (data || []).map((row: any) => ({
        ...row,
        lead_id: row.lead_id || null,
        lead_stage_name: row.lead?.stage?.name || null,
        lead: undefined, // remove nested object from thread
      }));
      setThreads(mapped);
    } catch (err: any) {
      console.error('Error fetching conversations:', err);
      toast.error('Erro ao carregar conversas');
    } finally {
      setLoadingThreads(false);
    }
  }, [orgId, filter, search, myProfileId]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async (conversationId: string) => {
    if (!orgId) return;
    setLoadingMessages(true);

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true })
        .limit(200);

      if (error) throw error;
      setMessages((data as any[]) || []);
    } catch (err: any) {
      console.error('Error fetching messages:', err);
      toast.error('Erro ao carregar mensagens');
    } finally {
      setLoadingMessages(false);
    }
  }, [orgId]);

  // Realtime: listen for new messages
  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel('inbox-messages-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          const newMsg = payload.new as any;
          if (newMsg.conversation_id === selectedThreadId) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
          }
          fetchThreads();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchThreads();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, selectedThreadId, fetchThreads]);

  // Zero unread_count when selecting a conversation
  const clearUnread = useCallback(async (conversationId: string) => {
    if (!orgId) return;
    try {
      await supabase
        .from('conversations')
        .update({ unread_count: 0 })
        .eq('id', conversationId)
        .eq('organization_id', orgId);

      setThreads(prev =>
        prev.map(t => t.id === conversationId ? { ...t, unread_count: 0 } : t)
      );
    } catch (err) {
      console.error('Error clearing unread:', err);
    }
  }, [orgId]);

  // Select conversation
  const selectThread = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
    if (threadId) {
      fetchMessages(threadId);
      clearUnread(threadId);
    }
  }, [fetchMessages, clearUnread]);

  // Check if current user can send in selected conversation
  const canSendMessage = useCallback((thread: InboxThread | null): boolean => {
    if (!thread || !profile) return false;
    if (isAdmin) return true;
    return thread.assigned_to === myProfileId;
  }, [isAdmin, profile, myProfileId]);

  // Send message (with optimistic update)
  const sendMessage = useCallback(async (text: string) => {
    if (!orgId || !selectedThreadId || !text.trim()) return;
    setSending(true);

    const optimisticMsg: InboxMessage = {
      id: `temp-${Date.now()}`,
      organization_id: orgId,
      conversation_id: selectedThreadId,
      direction: 'outbound',
      body: text.trim(),
      external_message_id: null,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticMsg]);

    try {
      const selectedConv = threads.find(t => t.id === selectedThreadId);
      const res = await supabase.functions.invoke('whatsapp-send', {
        body: {
          organization_id: orgId,
          thread_id: selectedThreadId,
          text: text.trim(),
          instance_name: selectedConv?.instance_name,
          phone: selectedConv?.contact_phone,
        },
      });

      if (res.error) throw new Error(res.error.message || 'Erro ao enviar');

      const data = res.data as any;
      if (data?.error) throw new Error(data.error);

      await fetchMessages(selectedThreadId);
      await fetchThreads();
    } catch (err: any) {
      console.error('Error sending message:', err);
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
      toast.error(err.message || 'Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  }, [orgId, selectedThreadId, threads, fetchMessages, fetchThreads]);

  // Assign conversation
  const assignThread = useCallback(async (threadId: string, profileId: string | null) => {
    if (!orgId) return;

    setThreads(prev =>
      prev.map(t => t.id === threadId
        ? { ...t, assigned_to: profileId, assigned_at: profileId ? new Date().toISOString() : null }
        : t
      )
    );

    try {
      console.log('[Inbox] Assigning conversation:', { threadId, profileId, orgId });
      const { error, data } = await supabase
        .from('conversations')
        .update({
          assigned_to: profileId,
          assigned_at: profileId ? new Date().toISOString() : null,
        })
        .eq('id', threadId)
        .eq('organization_id', orgId)
        .select('id, assigned_to');

      if (error) {
        console.error('[Inbox] Assignment DB error:', { code: error.code, message: error.message, details: error.details, hint: error.hint });
        throw error;
      }
      console.log('[Inbox] Assignment success:', data);
      toast.success(profileId ? 'Conversa atribuída' : 'Atribuição removida');
    } catch (err: any) {
      console.error('[Inbox] Assignment failed:', err);
      toast.error(err?.message || 'Erro ao atribuir conversa');
      await fetchThreads();
    }
  }, [orgId, fetchThreads]);

  // Create lead from conversation and link them
  const createLeadFromConversation = useCallback(async (
    conversationId: string,
    leadData: {
      name: string;
      phone: string;
      email?: string;
      seller_id: string;
      source?: string;
      interest?: string;
      observations?: string;
      valor_negocio?: number;
      servico?: string;
      cidade?: string;
      estado?: string;
      stage_id: string;
    }
  ): Promise<string | null> => {
    if (!orgId || !profile) return null;

    try {
      // 1. Create the lead
      const { data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert({
          ...leadData,
          created_by: profile.id,
          organization_id: orgId,
        })
        .select('id')
        .single();

      if (leadError) throw leadError;

      // 2. Link conversation -> lead
      const { error: linkError } = await supabase
        .from('conversations')
        .update({ lead_id: newLead.id } as any)
        .eq('id', conversationId)
        .eq('organization_id', orgId);

      if (linkError) throw linkError;

      // 3. Update local state
      setThreads(prev =>
        prev.map(t => t.id === conversationId ? { ...t, lead_id: newLead.id } : t)
      );

      // 4. Auto-distribute (non-blocking)
      (supabase.rpc as any)('distribute_lead', {
        p_lead_id: newLead.id,
        p_organization_id: orgId,
      }).then((res: any) => {
        if (res.error) console.error('Lead distribution error:', res.error);
      });

      // 5. Automation trigger (non-blocking)
      fetch("https://tapbwlmdvluqdgvixkxf.supabase.co/functions/v1/automation-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: orgId,
          trigger_type: "lead_created",
          entity_type: "lead",
          entity_id: newLead.id,
          context: {
            lead_name: leadData.name,
            lead_phone: leadData.phone,
            lead_email: leadData.email || '',
            lead_source: leadData.source || '',
            stage_id: leadData.stage_id,
            seller_id: leadData.seller_id,
          },
        }),
      }).catch(err => console.error("Automation trigger error:", err));

      toast.success('Lead criado e vinculado à conversa');
      await fetchThreads();
      return newLead.id;
    } catch (err: any) {
      console.error('Error creating lead from conversation:', err);
      toast.error(err.message || 'Erro ao criar lead');
      return null;
    }
  }, [orgId, profile, fetchThreads]);

  const selectedThread = threads.find(t => t.id === selectedThreadId) || null;

  // Toggle ai_mode for a conversation
  const toggleAiMode = useCallback(async (threadId: string, newMode: string) => {
    if (!orgId) return;
    try {
      const { error } = await supabase
        .from('conversations')
        .update({ ai_mode: newMode } as any)
        .eq('id', threadId)
        .eq('organization_id', orgId);
      if (error) throw error;
      setThreads(prev =>
        prev.map(t => t.id === threadId ? { ...t, ai_mode: newMode } : t)
      );
      toast.success(newMode === 'assisted' ? 'IA Assistente ativada' : 'IA desativada');
    } catch (err: any) {
      console.error('Error toggling ai_mode:', err);
      toast.error('Erro ao alterar modo da IA');
    }
  }, [orgId]);

  return {
    threads,
    messages,
    selectedThread,
    selectedThreadId,
    filter,
    search,
    loadingThreads,
    loadingMessages,
    sending,
    isAdmin,
    orgMembers,
    profile,
    myProfileId,
    setFilter,
    setSearch,
    selectThread,
    sendMessage,
    assignThread,
    canSendMessage,
    refreshThreads: fetchThreads,
    createLeadFromConversation,
    toggleAiMode,
  };
}
