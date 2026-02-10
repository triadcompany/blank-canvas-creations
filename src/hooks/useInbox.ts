import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface InboxThread {
  id: string;
  organization_id: string;
  instance_name: string;
  contact_phone: string;
  assigned_to: string | null;
  last_message_at: string | null;
  unread_count: number;
  created_at: string;
}

export interface InboxMessage {
  id: string;
  organization_id: string;
  conversation_id: string;
  direction: string;
  body: string;
  created_at: string;
}

export interface OrgMember {
  id: string;
  name: string;
  user_id: string;
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

  // Fetch org members for assignment dropdown
  const fetchOrgMembers = useCallback(async () => {
    if (!orgId) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, user_id')
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

  // Fetch conversations
  const fetchThreads = useCallback(async () => {
    if (!orgId) return;
    setLoadingThreads(true);

    try {
      let query = supabase
        .from('conversations')
        .select('*')
        .eq('organization_id', orgId)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      // Filter by assigned_to using auth user id
      const userId = profile?.user_id;

      if (filter === 'mine' && userId) {
        query = query.eq('assigned_to', userId);
      } else if (filter === 'unassigned') {
        query = query.is('assigned_to', null);
      }

      if (search.trim()) {
        query = query.ilike('contact_phone', `%${search}%`);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      setThreads((data as any[]) || []);
    } catch (err: any) {
      console.error('Error fetching conversations:', err);
      toast.error('Erro ao carregar conversas');
    } finally {
      setLoadingThreads(false);
    }
  }, [orgId, filter, search, profile?.user_id]);

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

  // Realtime: listen for conversation changes
  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel('inbox-conversations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchThreads();
          if (selectedThreadId) {
            fetchMessages(selectedThreadId);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchThreads, fetchMessages, selectedThreadId]);

  // Zero unread_count when selecting a conversation
  const clearUnread = useCallback(async (conversationId: string) => {
    if (!orgId) return;
    try {
      await supabase
        .from('conversations')
        .update({ unread_count: 0 })
        .eq('id', conversationId)
        .eq('organization_id', orgId);

      // Update locally
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
    return thread.assigned_to === profile.user_id;
  }, [isAdmin, profile]);

  // Send message
  const sendMessage = useCallback(async (text: string) => {
    if (!orgId || !selectedThreadId || !text.trim()) return;
    setSending(true);

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

      await Promise.all([
        fetchMessages(selectedThreadId),
        fetchThreads(),
      ]);

      toast.success('Mensagem enviada');
    } catch (err: any) {
      console.error('Error sending message:', err);
      toast.error(err.message || 'Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  }, [orgId, selectedThreadId, threads, fetchMessages, fetchThreads]);

  // Assign conversation
  const assignThread = useCallback(async (threadId: string, userId: string | null) => {
    if (!orgId) return;

    try {
      const { error } = await supabase
        .from('conversations')
        .update({ assigned_to: userId })
        .eq('id', threadId)
        .eq('organization_id', orgId);

      if (error) throw error;
      await fetchThreads();
      toast.success(userId ? 'Conversa atribuída' : 'Atribuição removida');
    } catch (err: any) {
      console.error('Error assigning conversation:', err);
      toast.error('Erro ao atribuir conversa');
    }
  }, [orgId, fetchThreads]);

  // Update conversation status (kept for compatibility, but conversations table doesn't have status)
  const updateThreadStatus = useCallback(async (_threadId: string, _status: string) => {
    // No status field in conversations table — no-op
  }, []);

  const selectedThread = threads.find(t => t.id === selectedThreadId) || null;

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
    setFilter,
    setSearch,
    selectThread,
    sendMessage,
    assignThread,
    updateThreadStatus,
    canSendMessage,
    refreshThreads: fetchThreads,
  };
}
