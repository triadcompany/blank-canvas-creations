import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface InboxThread {
  id: string;
  organization_id: string;
  instance_name: string;
  contact_phone_e164: string;
  contact_name: string | null;
  assigned_user_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  status: string;
  created_at: string;
}

export interface InboxMessage {
  id: string;
  organization_id: string;
  thread_id: string | null;
  direction: string;
  phone: string;
  message_text: string | null;
  status: string;
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

  // Fetch whatsapp_threads
  const fetchThreads = useCallback(async () => {
    if (!orgId) return;
    setLoadingThreads(true);

    try {
      let query = supabase
        .from('whatsapp_threads')
        .select('*')
        .eq('organization_id', orgId)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      const userId = profile?.user_id;

      if (filter === 'mine' && userId) {
        query = query.eq('assigned_user_id', userId);
      } else if (filter === 'unassigned') {
        query = query.is('assigned_user_id', null);
      }

      if (search.trim()) {
        query = query.or(`contact_phone_e164.ilike.%${search}%,contact_name.ilike.%${search}%`);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      setThreads((data as InboxThread[]) || []);
    } catch (err: any) {
      console.error('Error fetching threads:', err);
      toast.error('Erro ao carregar conversas');
    } finally {
      setLoadingThreads(false);
    }
  }, [orgId, filter, search, profile?.user_id]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // Fetch whatsapp_messages for selected thread
  const fetchMessages = useCallback(async (threadId: string) => {
    if (!orgId) return;
    setLoadingMessages(true);

    try {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('thread_id', threadId)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true })
        .limit(200);

      if (error) throw error;
      setMessages((data as InboxMessage[]) || []);
    } catch (err: any) {
      console.error('Error fetching messages:', err);
      toast.error('Erro ao carregar mensagens');
    } finally {
      setLoadingMessages(false);
    }
  }, [orgId]);

  // Zero unread_count when selecting a thread
  const clearUnread = useCallback(async (threadId: string) => {
    if (!orgId) return;
    try {
      await supabase
        .from('whatsapp_threads')
        .update({ unread_count: 0 })
        .eq('id', threadId)
        .eq('organization_id', orgId);

      setThreads(prev =>
        prev.map(t => t.id === threadId ? { ...t, unread_count: 0 } : t)
      );
    } catch (err) {
      console.error('Error clearing unread:', err);
    }
  }, [orgId]);

  // Select thread
  const selectThread = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
    if (threadId) {
      fetchMessages(threadId);
      clearUnread(threadId);
    }
  }, [fetchMessages, clearUnread]);

  // Check if current user can send in selected thread
  const canSendMessage = useCallback((thread: InboxThread | null): boolean => {
    if (!thread || !profile) return false;
    if (isAdmin) return true;
    return thread.assigned_user_id === profile.user_id;
  }, [isAdmin, profile]);

  // Send message
  const sendMessage = useCallback(async (text: string) => {
    if (!orgId || !selectedThreadId || !text.trim()) return;
    setSending(true);

    try {
      const res = await supabase.functions.invoke('whatsapp-send', {
        body: {
          organization_id: orgId,
          thread_id: selectedThreadId,
          text: text.trim(),
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
  }, [orgId, selectedThreadId, fetchMessages, fetchThreads]);

  // Assign thread
  const assignThread = useCallback(async (threadId: string, userId: string | null) => {
    if (!orgId) return;

    try {
      const { error } = await supabase
        .from('whatsapp_threads')
        .update({
          assigned_user_id: userId,
          assigned_at: userId ? new Date().toISOString() : null,
        })
        .eq('id', threadId)
        .eq('organization_id', orgId);

      if (error) throw error;
      await fetchThreads();
      toast.success(userId ? 'Conversa atribuída' : 'Atribuição removida');
    } catch (err: any) {
      console.error('Error assigning thread:', err);
      toast.error('Erro ao atribuir conversa');
    }
  }, [orgId, fetchThreads]);

  // Update thread status
  const updateThreadStatus = useCallback(async (threadId: string, status: string) => {
    if (!orgId) return;
    try {
      await supabase
        .from('whatsapp_threads')
        .update({ status })
        .eq('id', threadId)
        .eq('organization_id', orgId);
      await fetchThreads();
    } catch (err) {
      console.error('Error updating thread status:', err);
    }
  }, [orgId, fetchThreads]);

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
