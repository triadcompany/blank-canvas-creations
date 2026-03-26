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

type FilterMode = 'all' | 'mine' | 'unassigned' | 'open' | 'in_progress' | 'waiting_customer' | 'closed' | 'meta_ads';

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
  const { user, profile, role, isAdmin, orgId } = useAuth();
  const clerkUserId = user?.id || '';
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

  // Fetch conversations with lead info via RPC (bypasses RLS header issues)
  const fetchThreads = useCallback(async () => {
    if (!orgId || !clerkUserId) {
      setLoadingThreads(false);
      return;
    }
    setLoadingThreads(true);

    try {
      const { data, error } = await supabase.rpc('get_org_conversations' as any, {
        p_clerk_user_id: clerkUserId,
        p_org_id: orgId,
        p_is_admin: isAdmin,
        p_seller_id: myProfileId || null,
        p_filter: filter,
        p_search: search.trim(),
        p_limit: 100,
      });

      if (error) throw error;

      const parsed = (typeof data === 'string' ? JSON.parse(data) : data) || [];
      const mapped = parsed.map((row: any) => ({
        ...row,
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
  }, [orgId, clerkUserId, filter, search, myProfileId, isAdmin]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // Fetch messages for selected conversation via RPC
  const fetchMessages = useCallback(async (conversationId: string) => {
    if (!orgId || !clerkUserId) return;
    setLoadingMessages(true);

    try {
      const { data, error } = await supabase.rpc('get_conversation_messages' as any, {
        p_clerk_user_id: clerkUserId,
        p_org_id: orgId,
        p_conversation_id: conversationId,
        p_limit: 200,
      });

      if (error) throw error;

      const parsed = (typeof data === 'string' ? JSON.parse(data) : data) || [];
      setMessages(dedupeAndSort(parsed));
    } catch (err: any) {
      console.error('Error fetching messages:', err);
      toast.error('Erro ao carregar mensagens');
    } finally {
      setLoadingMessages(false);
    }
  }, [orgId, clerkUserId]);

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
    if (!orgId || !selectedThreadId || !clerkUserId) return;

    const interval = setInterval(async () => {
      try {
        // Re-fetch all messages for the conversation via RPC
        const { data, error } = await supabase.rpc('get_conversation_messages' as any, {
          p_clerk_user_id: clerkUserId,
          p_org_id: orgId,
          p_conversation_id: selectedThreadId,
          p_limit: 200,
        });

        if (error || !data) return;
        const parsed = (typeof data === 'string' ? JSON.parse(data) : data) || [];
        if (parsed.length === 0) return;

        setMessages(prev => {
          const newMsgs = dedupeAndSort(parsed);
          if (newMsgs.length === prev.length && newMsgs[newMsgs.length - 1]?.id === prev[prev.length - 1]?.id) {
            return prev; // No changes
          }
          return newMsgs;
        });
      } catch {
        // silent fallback
      }
    }, 7000);

    return () => clearInterval(interval);
  }, [orgId, selectedThreadId, clerkUserId]);

  // Helper to update conversation via RPC
  const rpcUpdateConversation = useCallback(async (conversationId: string, updates: Record<string, any>) => {
    if (!orgId || !clerkUserId) return;
    await supabase.rpc('update_conversation' as any, {
      p_clerk_user_id: clerkUserId,
      p_org_id: orgId,
      p_conversation_id: conversationId,
      p_updates: updates,
    });
  }, [orgId, clerkUserId]);

  // Helper to insert conversation event via RPC
  const rpcInsertEvent = useCallback(async (conversationId: string, eventType: string, metadata?: any) => {
    if (!orgId || !clerkUserId) return;
    await supabase.rpc('insert_conversation_event' as any, {
      p_clerk_user_id: clerkUserId,
      p_org_id: orgId,
      p_conversation_id: conversationId,
      p_event_type: eventType,
      p_metadata: metadata || null,
    });
  }, [orgId, clerkUserId]);

  // Zero unread_count when selecting a conversation
  const clearUnread = useCallback(async (conversationId: string) => {
    if (!orgId) return;
    try {
      await rpcUpdateConversation(conversationId, { unread_count: 0 });
      setThreads(prev =>
        prev.map(t => t.id === conversationId ? { ...t, unread_count: 0 } : t)
      );
    } catch (err) {
      console.error('Error clearing unread:', err);
    }
  }, [orgId, rpcUpdateConversation]);

  // Lock conversation when selecting it
  const lockConversation = useCallback(async (conversationId: string) => {
    if (!orgId || !myProfileId) return;
    
    const thread = threadsRef.current.find(t => t.id === conversationId);
    if (!thread) return;
    
    // Only lock if not already locked by someone else
    if (thread.locked_by && thread.locked_by !== myProfileId) return;
    
    try {
      await rpcUpdateConversation(conversationId, { locked_by: myProfileId, locked_at: new Date().toISOString() });
      setThreads(prev =>
        prev.map(t => t.id === conversationId ? { ...t, locked_by: myProfileId, locked_at: new Date().toISOString() } : t)
      );
    } catch (err) {
      console.error('Error locking conversation:', err);
    }
  }, [orgId, myProfileId, rpcUpdateConversation]);

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

    setThreads(prev =>
      prev.map(t => t.id === threadId ? { ...t, status: newStatus, last_status_change_at: new Date().toISOString() } : t)
    );

    try {
      await rpcUpdateConversation(threadId, { status: newStatus, last_status_change_at: new Date().toISOString() });

      const eventMap: Record<ConversationStatus, string> = {
        open: 'reopened',
        in_progress: 'assumed',
        waiting_customer: 'waiting',
        closed: 'closed',
      };
      await rpcInsertEvent(threadId, eventMap[newStatus]);

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
  }, [orgId, myProfileId, fetchThreads, rpcUpdateConversation, rpcInsertEvent]);

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
      await rpcUpdateConversation(threadId, {
        assigned_to: myProfileId,
        assigned_at: new Date().toISOString(),
        status: 'in_progress',
        locked_by: myProfileId,
        locked_at: new Date().toISOString(),
        last_status_change_at: new Date().toISOString(),
      });
      await rpcInsertEvent(threadId, 'assumed');
      toast.success('Conversa assumida');
    } catch (err: any) {
      console.error('Error assuming conversation:', err);
      toast.error('Erro ao assumir conversa');
      fetchThreads();
    }
  }, [orgId, myProfileId, fetchThreads, rpcUpdateConversation, rpcInsertEvent]);

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
      await rpcUpdateConversation(threadId, {
        locked_by: null,
        locked_at: null,
        status: 'open',
        last_status_change_at: new Date().toISOString(),
      });
      await rpcInsertEvent(threadId, 'released');
      toast.success('Conversa liberada');
    } catch (err: any) {
      console.error('Error releasing conversation:', err);
      toast.error('Erro ao liberar conversa');
      fetchThreads();
    }
  }, [orgId, myProfileId, fetchThreads, rpcUpdateConversation, rpcInsertEvent]);

  // Close conversation
  const closeConversation = useCallback(async (threadId: string) => {
    if (!orgId || !myProfileId) return;
    await updateStatus(threadId, 'closed');
    await rpcUpdateConversation(threadId, { locked_by: null, locked_at: null });
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
        await rpcUpdateConversation(selectedThreadId, { ai_state: 'human_active' });

        setThreads(prev =>
          prev.map(t => t.id === selectedThreadId ? { ...t, ai_state: 'human_active' } : t)
        );
      }

      await rpcUpdateConversation(selectedThreadId, { status: 'waiting_customer', last_status_change_at: new Date().toISOString() });

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
      await rpcUpdateConversation(threadId, {
        assigned_to: profileId,
        assigned_at: profileId ? new Date().toISOString() : null,
      });
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

      // Link lead to conversation via RPC
      await rpcUpdateConversation(conversationId, { lead_id: newLead.id });

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
      await rpcUpdateConversation(threadId, updateData);

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
  }, [orgId, rpcUpdateConversation]);

  // Resume AI
  const resumeAi = useCallback(async (threadId: string) => {
    if (!orgId) return;
    try {
      await rpcUpdateConversation(threadId, { ai_state: 'ai_active', ai_reply_count_since_last_lead: 0 });

      setThreads(prev =>
        prev.map(t => t.id === threadId ? { ...t, ai_state: 'ai_active', ai_reply_count_since_last_lead: 0 } : t)
      );
      toast.success('IA retomada');
    } catch (err: any) {
      console.error('Error resuming AI:', err);
      toast.error('Erro ao retomar IA');
    }
  }, [orgId, rpcUpdateConversation]);

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
