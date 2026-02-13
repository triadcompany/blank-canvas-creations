import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type ConversationStatus = 'open' | 'in_progress' | 'waiting_customer' | 'closed';

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
  ai_state: string | null;
  last_ai_reply_at: string | null;
  ai_reply_count_since_last_lead: number;
  ai_pending: boolean;
  ai_pending_started_at: string | null;
  // New fields
  status: ConversationStatus;
  locked_by: string | null;
  locked_at: string | null;
  last_status_change_at: string | null;
}

export interface InboxMessage {
  id: string;
  organization_id: string;
  conversation_id: string;
  direction: string;
  body: string;
  external_message_id: string | null;
  created_at: string;
  ai_generated?: boolean;
  ai_interaction_id?: string | null;
  message_type?: string;
  media_url?: string | null;
  mime_type?: string | null;
  duration_ms?: number | null;
}

export interface OrgMember {
  id: string;
  name: string;
}

type FilterMode = 'all' | 'mine' | 'unassigned' | 'open' | 'in_progress' | 'waiting_customer' | 'closed';

// Deduplicate and sort messages
function dedupeAndSort(msgs: InboxMessage[]): InboxMessage[] {
  const map = new Map<string, InboxMessage>();
  for (const m of msgs) {
    const existing = map.get(m.id);
    if (!existing || (existing.id.startsWith('temp-') && !m.id.startsWith('temp-'))) {
      map.set(m.id, m);
    }
    if (m.external_message_id) {
      const byExt = [...map.values()].find(
        x => x.external_message_id === m.external_message_id && x.id !== m.id
      );
      if (byExt && byExt.id.startsWith('temp-')) {
        map.delete(byExt.id);
      }
    }
  }
  return [...map.values()].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

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
  const [newMessageFlag, setNewMessageFlag] = useState(0);

  const orgId = profile?.organization_id;
  const myProfileId = profile?.id;

  const selectedThreadIdRef = useRef(selectedThreadId);
  selectedThreadIdRef.current = selectedThreadId;
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

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
    if (!orgId) {
      setLoadingThreads(false);
      return;
    }
    setLoadingThreads(true);

    try {
      let query = supabase
        .from('conversations')
        .select('*, lead:leads!lead_id(id, stage_id, stage:pipeline_stages!stage_id(name))')
        .eq('organization_id', orgId)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      // Apply filters
      if (filter === 'mine' && myProfileId) {
        query = query.eq('assigned_to', myProfileId);
      } else if (filter === 'unassigned') {
        query = query.is('assigned_to', null);
      } else if (['open', 'in_progress', 'waiting_customer', 'closed'].includes(filter)) {
        query = query.eq('status', filter);
        // Sellers can only see their own + unassigned conversations
        if (!isAdmin && myProfileId) {
          query = query.or(`assigned_to.eq.${myProfileId},assigned_to.is.null`);
        }
      } else if (filter === 'all' && !isAdmin && myProfileId) {
        // Sellers: show only their own + unassigned
        query = query.or(`assigned_to.eq.${myProfileId},assigned_to.is.null`);
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
        lead: undefined,
        status: row.status || 'open',
        locked_by: row.locked_by || null,
        locked_at: row.locked_at || null,
        last_status_change_at: row.last_status_change_at || null,
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
      setMessages(dedupeAndSort((data as any[]) || []));
    } catch (err: any) {
      console.error('Error fetching messages:', err);
      toast.error('Erro ao carregar mensagens');
    } finally {
      setLoadingMessages(false);
    }
  }, [orgId]);

  // ── Realtime subscriptions ──
  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel(`inbox-rt-${orgId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          const newMsg = payload.new as InboxMessage;

          if (newMsg.conversation_id === selectedThreadIdRef.current) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              if (newMsg.external_message_id && prev.some(m => m.external_message_id === newMsg.external_message_id)) {
                return dedupeAndSort([...prev.filter(m => m.external_message_id !== newMsg.external_message_id), newMsg]);
              }
              const withoutOptimistic = prev.filter(m => {
                if (!m.id.startsWith('temp-')) return true;
                return !(m.body === newMsg.body && m.direction === newMsg.direction);
              });
              return dedupeAndSort([...withoutOptimistic, newMsg]);
            });

            if (newMsg.direction === 'inbound') {
              setNewMessageFlag(f => f + 1);
            }
          }

          setThreads(prev => {
            const updated = prev.map(t => {
              if (t.id !== newMsg.conversation_id) return t;
              return {
                ...t,
                last_message_at: newMsg.created_at,
                last_message_preview: (newMsg.body || '').substring(0, 100),
                unread_count: newMsg.conversation_id === selectedThreadIdRef.current
                  ? 0
                  : t.unread_count + (newMsg.direction === 'inbound' ? 1 : 0),
              };
            });
            return updated.sort((a, b) => {
              const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
              const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
              return tb - ta;
            });
          });
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
        (payload) => {
          const updated = payload.new as any;
          setThreads(prev => {
            const newList = prev.map(t => {
              if (t.id !== updated.id) return t;
              return {
                ...t,
                last_message_at: updated.last_message_at ?? t.last_message_at,
                last_message_preview: updated.last_message_preview ?? t.last_message_preview,
                unread_count: updated.unread_count ?? t.unread_count,
                assigned_to: updated.assigned_to ?? t.assigned_to,
                assigned_at: updated.assigned_at ?? t.assigned_at,
                contact_name: updated.contact_name ?? t.contact_name,
                lead_id: updated.lead_id ?? t.lead_id,
                ai_mode: updated.ai_mode ?? t.ai_mode,
                ai_state: updated.ai_state !== undefined ? updated.ai_state : t.ai_state,
                ai_pending: updated.ai_pending !== undefined ? updated.ai_pending : t.ai_pending,
                ai_pending_started_at: updated.ai_pending_started_at !== undefined ? updated.ai_pending_started_at : t.ai_pending_started_at,
                status: updated.status ?? t.status,
                locked_by: updated.locked_by !== undefined ? updated.locked_by : t.locked_by,
                locked_at: updated.locked_at !== undefined ? updated.locked_at : t.locked_at,
                last_status_change_at: updated.last_status_change_at !== undefined ? updated.last_status_change_at : t.last_status_change_at,
              };
            });
            return newList.sort((a, b) => {
              const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
              const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
              return tb - ta;
            });
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
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
  }, [orgId, fetchThreads]);

  // ── Fallback polling ──
  useEffect(() => {
    if (!orgId || !selectedThreadId) return;

    const interval = setInterval(async () => {
      try {
        const lastMsg = messages[messages.length - 1];
        const since = lastMsg?.created_at || new Date(0).toISOString();
        
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', selectedThreadId)
          .eq('organization_id', orgId)
          .gt('created_at', since)
          .order('created_at', { ascending: true })
          .limit(50);

        if (error || !data?.length) return;

        setMessages(prev => dedupeAndSort([...prev, ...(data as InboxMessage[])]));
      } catch {
        // silent fallback
      }
    }, 7000);

    return () => clearInterval(interval);
  }, [orgId, selectedThreadId, messages]);

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

  // Lock conversation when selecting it
  const lockConversation = useCallback(async (conversationId: string) => {
    if (!orgId || !myProfileId) return;
    
    const thread = threadsRef.current.find(t => t.id === conversationId);
    if (!thread) return;
    
    // Only lock if not already locked by someone else
    if (thread.locked_by && thread.locked_by !== myProfileId) return;
    
    try {
      await (supabase as any)
        .from('conversations')
        .update({ locked_by: myProfileId, locked_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('organization_id', orgId);

      setThreads(prev =>
        prev.map(t => t.id === conversationId ? { ...t, locked_by: myProfileId, locked_at: new Date().toISOString() } : t)
      );
    } catch (err) {
      console.error('Error locking conversation:', err);
    }
  }, [orgId, myProfileId]);

  // Select conversation
  const selectThread = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
    if (threadId) {
      fetchMessages(threadId);
      clearUnread(threadId);
      lockConversation(threadId);
    }
  }, [fetchMessages, clearUnread, lockConversation]);

  // Check if current user can send in selected conversation
  const canSendMessage = useCallback((thread: InboxThread | null): boolean => {
    if (!thread || !profile) return false;
    if (isAdmin) return true;
    // Check lock
    if (thread.locked_by && thread.locked_by !== myProfileId) return false;
    return thread.assigned_to === myProfileId;
  }, [isAdmin, profile, myProfileId]);

  // Get lock info for display
  const getLockedByName = useCallback((thread: InboxThread | null): string | null => {
    if (!thread?.locked_by) return null;
    if (thread.locked_by === myProfileId) return null; // Don't show if it's the current user
    const member = orgMembers.find(m => m.id === thread.locked_by);
    return member?.name || 'Outro usuário';
  }, [orgMembers, myProfileId]);

  // Update conversation status
  const updateStatus = useCallback(async (threadId: string, newStatus: ConversationStatus) => {
    if (!orgId || !myProfileId) return;

    // Optimistic update
    setThreads(prev =>
      prev.map(t => t.id === threadId ? { ...t, status: newStatus, last_status_change_at: new Date().toISOString() } : t)
    );

    try {
      await (supabase as any)
        .from('conversations')
        .update({ status: newStatus, last_status_change_at: new Date().toISOString() })
        .eq('id', threadId)
        .eq('organization_id', orgId);

      // Log event
      const eventMap: Record<ConversationStatus, string> = {
        open: 'reopened',
        in_progress: 'assumed',
        waiting_customer: 'waiting',
        closed: 'closed',
      };

      await (supabase as any)
        .from('conversation_events')
        .insert({
          organization_id: orgId,
          conversation_id: threadId,
          event_type: eventMap[newStatus],
          performed_by: myProfileId,
        });

      const labels: Record<ConversationStatus, string> = {
        open: 'Conversa reaberta',
        in_progress: 'Em atendimento',
        waiting_customer: 'Aguardando cliente',
        closed: 'Conversa finalizada',
      };
      toast.success(labels[newStatus]);
    } catch (err: any) {
      console.error('Error updating status:', err);
      toast.error('Erro ao atualizar status');
      fetchThreads();
    }
  }, [orgId, myProfileId, fetchThreads]);

  // Assume conversation (assign + set in_progress + lock)
  const assumeConversation = useCallback(async (threadId: string) => {
    if (!orgId || !myProfileId) return;

    setThreads(prev =>
      prev.map(t => t.id === threadId ? {
        ...t,
        assigned_to: myProfileId,
        assigned_at: new Date().toISOString(),
        status: 'in_progress' as ConversationStatus,
        locked_by: myProfileId,
        locked_at: new Date().toISOString(),
        last_status_change_at: new Date().toISOString(),
      } : t)
    );

    try {
      await (supabase as any)
        .from('conversations')
        .update({
          assigned_to: myProfileId,
          assigned_at: new Date().toISOString(),
          status: 'in_progress',
          locked_by: myProfileId,
          locked_at: new Date().toISOString(),
          last_status_change_at: new Date().toISOString(),
        })
        .eq('id', threadId)
        .eq('organization_id', orgId);

      await (supabase as any)
        .from('conversation_events')
        .insert({
          organization_id: orgId,
          conversation_id: threadId,
          event_type: 'assumed',
          performed_by: myProfileId,
        });

      toast.success('Conversa assumida');
    } catch (err: any) {
      console.error('Error assuming conversation:', err);
      toast.error('Erro ao assumir conversa');
      fetchThreads();
    }
  }, [orgId, myProfileId, fetchThreads]);

  // Release conversation (unlock + remove assignment)
  const releaseConversation = useCallback(async (threadId: string) => {
    if (!orgId || !myProfileId) return;

    setThreads(prev =>
      prev.map(t => t.id === threadId ? {
        ...t,
        locked_by: null,
        locked_at: null,
        status: 'open' as ConversationStatus,
        last_status_change_at: new Date().toISOString(),
      } : t)
    );

    try {
      await (supabase as any)
        .from('conversations')
        .update({
          locked_by: null,
          locked_at: null,
          status: 'open',
          last_status_change_at: new Date().toISOString(),
        })
        .eq('id', threadId)
        .eq('organization_id', orgId);

      await (supabase as any)
        .from('conversation_events')
        .insert({
          organization_id: orgId,
          conversation_id: threadId,
          event_type: 'released',
          performed_by: myProfileId,
        });

      toast.success('Conversa liberada');
    } catch (err: any) {
      console.error('Error releasing conversation:', err);
      toast.error('Erro ao liberar conversa');
      fetchThreads();
    }
  }, [orgId, myProfileId, fetchThreads]);

  // Close conversation
  const closeConversation = useCallback(async (threadId: string) => {
    if (!orgId || !myProfileId) return;
    await updateStatus(threadId, 'closed');
    
    // Also unlock
    await (supabase as any)
      .from('conversations')
      .update({ locked_by: null, locked_at: null })
      .eq('id', threadId)
      .eq('organization_id', orgId);

    setThreads(prev =>
      prev.map(t => t.id === threadId ? { ...t, locked_by: null, locked_at: null } : t)
    );
  }, [orgId, myProfileId, updateStatus]);

  // Send message (with optimistic update + auto status change)
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
    setMessages(prev => dedupeAndSort([...prev, optimisticMsg]));

    setThreads(prev => {
      const updated = prev.map(t => {
        if (t.id !== selectedThreadId) return t;
        return {
          ...t,
          last_message_at: optimisticMsg.created_at,
          last_message_preview: text.trim().substring(0, 100),
          status: 'waiting_customer' as ConversationStatus,
          last_status_change_at: new Date().toISOString(),
        };
      });
      return updated.sort((a, b) => {
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return tb - ta;
      });
    });

    try {
      const selectedConv = threadsRef.current.find(t => t.id === selectedThreadId);

      // If in AUTO mode, pause AI when human sends
      if (selectedConv?.ai_mode === 'auto') {
        await supabase
          .from('conversations')
          .update({ ai_state: 'human_active', ai_pending: false, ai_pending_started_at: null } as any)
          .eq('id', selectedThreadId)
          .eq('organization_id', orgId);

        setThreads(prev =>
          prev.map(t => t.id === selectedThreadId ? { ...t, ai_state: 'human_active' } : t)
        );
      }

      // Update status to waiting_customer
      await (supabase as any)
        .from('conversations')
        .update({ status: 'waiting_customer', last_status_change_at: new Date().toISOString() })
        .eq('id', selectedThreadId)
        .eq('organization_id', orgId);

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
    } catch (err: any) {
      console.error('Error sending message:', err);
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
      toast.error(err.message || 'Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  }, [orgId, selectedThreadId]);

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
      const { error } = await supabase
        .from('conversations')
        .update({
          assigned_to: profileId,
          assigned_at: profileId ? new Date().toISOString() : null,
        })
        .eq('id', threadId)
        .eq('organization_id', orgId)
        .select('id, assigned_to');

      if (error) throw error;
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

      const { error: linkError } = await supabase
        .from('conversations')
        .update({ lead_id: newLead.id } as any)
        .eq('id', conversationId)
        .eq('organization_id', orgId);

      if (linkError) throw linkError;

      setThreads(prev =>
        prev.map(t => t.id === conversationId ? { ...t, lead_id: newLead.id } : t)
      );

      (supabase.rpc as any)('distribute_lead', {
        p_lead_id: newLead.id,
        p_organization_id: orgId,
      }).then((res: any) => {
        if (res.error) console.error('Lead distribution error:', res.error);
      });

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

    const validModes = ['off', 'assisted', 'auto'];
    if (!validModes.includes(newMode)) {
      console.error('[Inbox] Invalid ai_mode value:', newMode);
      toast.error(`Valor inválido para modo IA: "${newMode}"`);
      return;
    }

    const prevThread = threadsRef.current.find(t => t.id === threadId);
    const prevMode = prevThread?.ai_mode;
    const prevState = prevThread?.ai_state;

    const updateData: { ai_mode: string; ai_state: string | null } = {
      ai_mode: newMode,
      ai_state: newMode === 'auto' ? 'ai_active' : null,
    };

    setThreads(prev =>
      prev.map(t => t.id === threadId ? { ...t, ...updateData } : t)
    );

    try {
      const { error } = await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', threadId)
        .eq('organization_id', orgId);

      if (error) throw error;

      const modeLabels: Record<string, string> = {
        off: 'IA desativada',
        assisted: 'IA Assistente ativada',
        auto: 'IA Autônoma ativada',
      };
      toast.success(modeLabels[newMode] || 'Modo alterado');
    } catch (err: any) {
      console.error('[Inbox] Error toggling ai_mode:', err);
      setThreads(prev =>
        prev.map(t => t.id === threadId ? { ...t, ai_mode: prevMode || 'off', ai_state: prevState || null } : t)
      );
      const detail = err?.message || err?.code || 'Erro desconhecido';
      toast.error(`Erro ao alterar modo da IA: ${detail}`);
    }
  }, [orgId]);

  // Resume AI
  const resumeAi = useCallback(async (threadId: string) => {
    if (!orgId) return;
    try {
      const { error } = await supabase
        .from('conversations')
        .update({ ai_state: 'ai_active', ai_reply_count_since_last_lead: 0 } as any)
        .eq('id', threadId)
        .eq('organization_id', orgId);
      if (error) throw error;

      setThreads(prev =>
        prev.map(t => t.id === threadId ? { ...t, ai_state: 'ai_active', ai_reply_count_since_last_lead: 0 } : t)
      );
      toast.success('IA retomada');
    } catch (err: any) {
      console.error('Error resuming AI:', err);
      toast.error('Erro ao retomar IA');
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
    newMessageFlag,
    setFilter,
    setSearch,
    selectThread,
    sendMessage,
    assignThread,
    canSendMessage,
    getLockedByName,
    refreshThreads: fetchThreads,
    createLeadFromConversation,
    toggleAiMode,
    resumeAi,
    // New actions
    updateStatus,
    assumeConversation,
    releaseConversation,
    closeConversation,
  };
}
