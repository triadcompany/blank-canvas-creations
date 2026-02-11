import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useInbox, InboxThread, InboxMessage } from '@/hooks/useInbox';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, isToday, isYesterday, parseISO, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  MessageSquare,
  Send,
  Search,
  Phone,
  User,
  CheckCheck,
  ArrowLeft,
  Loader2,
  Inbox as InboxIcon,
  UserPlus,
  UserMinus,
  ChevronDown,
  ExternalLink,
  Plus,
  Sparkles,
  Bot,
  Pause,
  Play,
  AlertCircle,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { CreateLeadFromInboxModal } from '@/components/inbox/CreateLeadFromInboxModal';
import { AiSuggestionPanel } from '@/components/inbox/AiSuggestionPanel';
import { ConversationIntelligenceBadge } from '@/components/inbox/ConversationIntelligenceBadge';
import { AudioPlayer } from '@/components/inbox/AudioPlayer';
import { AudioRecorder } from '@/components/inbox/AudioRecorder';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

const BLOCK_REASON_LABELS: Record<string, string> = {
  throttle_active: 'Throttle ativo',
  max_ai_replies_without_lead_response: 'Máx. respostas sem retorno do lead',
  ai_state_human_active: 'Humano assumiu',
  idempotency_duplicate: 'Mensagem já processada',
  debounce_waiting: 'Debounce (msg mais recente chegou)',
  sensitive_stage: 'Etapa sensível',
  ai_mode_not_auto: 'Modo IA não é AUTO',
  missing_context: 'Contexto insuficiente',
};

// ── Helpers ──

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    const ddd = digits.substring(2, 4);
    const num = digits.substring(4);
    return `(${ddd}) ${num.substring(0, 5)}-${num.substring(5)}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    const ddd = digits.substring(2, 4);
    const num = digits.substring(4);
    return `(${ddd}) ${num.substring(0, 4)}-${num.substring(4)}`;
  }
  if (digits.length === 11) {
    return `(${digits.substring(0, 2)}) ${digits.substring(2, 7)}-${digits.substring(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.substring(0, 2)}) ${digits.substring(2, 6)}-${digits.substring(6)}`;
  }
  return phone;
}

function getContactDisplay(thread: InboxThread): { name: string; subtitle: string } {
  const formattedPhone = formatPhone(thread.contact_phone);
  if (thread.contact_name) {
    return { name: thread.contact_name, subtitle: formattedPhone };
  }
  return { name: formattedPhone, subtitle: '' };
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatMessageTime(dateStr: string) {
  const date = parseISO(dateStr);
  return format(date, 'HH:mm');
}

function formatThreadTime(dateStr: string | null) {
  if (!dateStr) return '';
  const date = parseISO(dateStr);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Ontem';
  return format(date, 'dd/MM', { locale: ptBR });
}

function formatDateSeparator(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return 'Hoje';
  if (isYesterday(date)) return 'Ontem';
  return format(date, "dd 'de' MMMM", { locale: ptBR });
}

// ── Thread List Item ──

function ThreadItem({
  thread,
  selected,
  onClick,
  assignedName,
}: {
  thread: InboxThread;
  selected: boolean;
  onClick: () => void;
  assignedName?: string;
}) {
  const { name, subtitle } = getContactDisplay(thread);
  const initials = getInitials(name);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-3 border-b border-border/50 transition-all duration-150',
        'hover:bg-accent/40',
        selected && 'bg-accent/60 border-l-2 border-l-primary'
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10 flex-shrink-0">
          {thread.profile_picture_url && (
            <AvatarImage src={thread.profile_picture_url} alt={name} />
          )}
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={cn(
              'text-sm truncate block',
              thread.unread_count > 0 ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'
            )}>
              {name}
            </span>
            <span className={cn(
              'text-[10px] whitespace-nowrap flex-shrink-0',
              thread.unread_count > 0 ? 'text-primary font-semibold' : 'text-muted-foreground'
            )}>
              {formatThreadTime(thread.last_message_at)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className={cn(
              'text-xs truncate',
              thread.unread_count > 0 ? 'text-foreground/80 font-medium' : 'text-muted-foreground'
            )}>
              {thread.last_message_preview || (subtitle || 'Sem mensagens')}
            </p>
            {thread.unread_count > 0 && (
              <Badge className="h-[18px] min-w-[18px] px-1 text-[10px] font-bold bg-primary text-primary-foreground rounded-full flex items-center justify-center flex-shrink-0">
                {thread.unread_count}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1 mt-1">
            {thread.lead_id ? (
              <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-semibold">
                Lead {thread.lead_stage_name ? `• ${thread.lead_stage_name}` : ''}
              </Badge>
            ) : (
              <>
                <User className="h-2.5 w-2.5 text-muted-foreground/60" />
                <span className={cn(
                  'text-[10px]',
                  assignedName ? 'text-muted-foreground/60' : 'text-destructive/70'
                )}>
                  {assignedName || 'Não atribuída'}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Date Separator ──

function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center justify-center my-4">
      <div className="bg-muted/80 text-muted-foreground text-[11px] font-medium px-3 py-1 rounded-full">
        {formatDateSeparator(date)}
      </div>
    </div>
  );
}

// ── Message Bubble ──

function MessageBubble({ message }: { message: InboxMessage }) {
  const isOutbound = message.direction === 'outbound';
  const isOptimistic = message.id.startsWith('temp-');
  const isAiGenerated = message.ai_generated === true;
  const isAudio = message.message_type === 'audio' && message.media_url;

  return (
    <div className={cn('flex mb-1.5', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
          isOutbound
            ? isAiGenerated
              ? 'bg-primary/80 text-primary-foreground rounded-br-md border border-primary/30'
              : 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-card border border-border/50 rounded-bl-md',
          isOptimistic && 'opacity-70'
        )}
      >
        {isAiGenerated && (
          <div className={cn(
            'flex items-center gap-1 mb-1 text-[10px] font-medium',
            isOutbound ? 'text-primary-foreground/60' : 'text-muted-foreground'
          )}>
            <Bot className="h-3 w-3" />
            <span>IA</span>
          </div>
        )}
        {isAudio ? (
          <AudioPlayer
            src={message.media_url!}
            durationMs={message.duration_ms}
            isOutbound={isOutbound}
          />
        ) : (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>
        )}
        <div
          className={cn(
            'flex items-center justify-end gap-1 mt-0.5',
            isOutbound ? 'text-primary-foreground/50' : 'text-muted-foreground/60'
          )}
        >
          <span className="text-[10px]">{formatMessageTime(message.created_at)}</span>
          {isOutbound && (
            isOptimistic
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <CheckCheck className="h-3 w-3" />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Empty States ──

function EmptyThreadList() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <InboxIcon className="h-8 w-8 text-muted-foreground/40" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">Nenhuma conversa</p>
      <p className="text-xs text-muted-foreground/60 mt-1 max-w-[200px]">
        As conversas aparecerão quando mensagens forem recebidas via WhatsApp
      </p>
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="w-20 h-20 rounded-full bg-muted/30 flex items-center justify-center mb-5">
        <MessageSquare className="h-10 w-10 text-muted-foreground/30" />
      </div>
      <h3 className="font-semibold text-foreground/80 text-lg">Selecione uma conversa</h3>
      <p className="text-sm text-muted-foreground/60 mt-2 max-w-[280px]">
        Escolha uma conversa na lista para visualizar e responder mensagens
      </p>
    </div>
  );
}

// ── Messages with date groups ──

function MessagesList({ messages }: { messages: InboxMessage[] }) {
  const grouped = useMemo(() => {
    const result: { type: 'date' | 'message'; date?: string; message?: InboxMessage }[] = [];
    let lastDate: string | null = null;

    for (const msg of messages) {
      const msgDate = msg.created_at;
      if (!lastDate || !isSameDay(parseISO(lastDate), parseISO(msgDate))) {
        result.push({ type: 'date', date: msgDate });
        lastDate = msgDate;
      }
      result.push({ type: 'message', message: msg });
    }
    return result;
  }, [messages]);

  return (
    <>
      {grouped.map((item, i) =>
        item.type === 'date' ? (
          <DateSeparator key={`date-${i}`} date={item.date!} />
        ) : (
          <MessageBubble key={item.message!.id} message={item.message!} />
        )
      )}
    </>
  );
}

// ── AI Thinking Indicator ──

function AiThinkingIndicator({ startedAt }: { startedAt: string | null }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const start = new Date(startedAt).getTime();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const isDelayed = elapsed > 40;

  return (
    <div className="flex justify-start mb-1.5">
      <div className={cn(
        'max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm rounded-bl-md border',
        isDelayed
          ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
          : 'bg-muted/60 border-border/50'
      )}>
        <div className="flex items-center gap-2">
          <Bot className="h-3.5 w-3.5 text-muted-foreground" />
          <span className={cn(
            'text-xs font-medium',
            isDelayed ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
          )}>
            {isDelayed ? 'IA está pensando mais que o esperado…' : 'IA está pensando…'}
          </span>
          <span className="flex gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main Inbox Page ──

export default function InboxPage() {
  const {
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
    createLeadFromConversation,
    toggleAiMode,
    resumeAi,
    refreshThreads,
    newMessageFlag,
  } = useInbox();

  const navigate = useNavigate();
  const [messageText, setMessageText] = useState('');
  const [assignPopoverOpen, setAssignPopoverOpen] = useState(false);
  const [createLeadModalOpen, setCreateLeadModalOpen] = useState(false);
  const [resetFirstTouchOpen, setResetFirstTouchOpen] = useState(false);
  const [resetAlsoDeleteLead, setResetAlsoDeleteLead] = useState(false);
  const [resettingFirstTouch, setResettingFirstTouch] = useState(false);
  const [firstTouchResetDone, setFirstTouchResetDone] = useState(false);
  const [ftStatusOpen, setFtStatusOpen] = useState(false);
  const [ftStatusData, setFtStatusData] = useState<any>(null);
  const [ftStatusLoading, setFtStatusLoading] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const canSend = canSendMessage(selectedThread);

  // Query latest AI block reason for the selected conversation
  const { data: lastBlockedJob } = useQuery({
    queryKey: ['ai-block-reason', selectedThreadId],
    queryFn: async () => {
      if (!selectedThreadId) return null;
      const { data } = await (supabase as any)
        .from('ai_auto_reply_jobs')
        .select('id, status, error, result, processed_at')
        .eq('conversation_id', selectedThreadId)
        .eq('status', 'blocked')
        .order('processed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!selectedThreadId && selectedThread?.ai_mode === 'auto',
    refetchInterval: 15000,
  });

  // Map profile.id -> name for assignment display
  const memberNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    orgMembers.forEach((m) => { map[m.id] = m.name; });
    return map;
  }, [orgMembers]);

  // Track scroll position to decide auto-scroll
  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (!el) return;
    const threshold = 80;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (isAtBottomRef.current) {
      setNewMsgCount(0);
    }
  }, []);

  // Auto-scroll only when at bottom, otherwise show indicator
  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setNewMsgCount(0);
    } else if (newMessageFlag > 0) {
      setNewMsgCount(c => c + 1);
    }
  }, [messages, newMessageFlag]);

  // Reset scroll state when switching conversations
  useEffect(() => {
    isAtBottomRef.current = true;
    setNewMsgCount(0);
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' as any });
    }, 100);
  }, [selectedThreadId]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    isAtBottomRef.current = true;
    setNewMsgCount(0);
  }, []);

  const handleSend = async () => {
    if (!messageText.trim() || sending || !canSend) return;
    const text = messageText;
    setMessageText('');
    await sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAssign = async (profileId: string | null) => {
    if (!selectedThread) return;
    setAssignPopoverOpen(false);
    await assignThread(selectedThread.id, profileId);
  };

  const handleResetFirstTouch = async () => {
    if (!selectedThread || !profile?.organization_id) return;
    setResettingFirstTouch(true);
    try {
      const res = await supabase.functions.invoke('reset-first-touch', {
        body: {
          organization_id: profile.organization_id,
          phone: selectedThread.contact_phone,
          channel: 'whatsapp',
        },
      });

      if (res.error) throw new Error(res.error.message || 'Erro ao resetar');
      const data = res.data as any;
      if (!data?.ok) throw new Error(data?.error || 'Erro desconhecido');

      if (resetAlsoDeleteLead && selectedThread.lead_id) {
        await supabase
          .from('conversations')
          .update({ lead_id: null } as any)
          .eq('id', selectedThread.id)
          .eq('organization_id', profile.organization_id);

        await supabase
          .from('leads')
          .delete()
          .eq('id', selectedThread.lead_id)
          .eq('organization_id', profile.organization_id);
      }

      if (data.deleted_count > 0) {
        toast.success(`Reset feito. ${data.deleted_count} registro(s) removido(s). A próxima mensagem pode disparar a automação.`);
        setFirstTouchResetDone(true);
        setTimeout(() => setFirstTouchResetDone(false), 15000);
      } else {
        toast.warning('Nada para resetar. O first-touch já foi removido ou o telefone não corresponde.');
      }
      refreshThreads();
    } catch (err: any) {
      console.error('Error resetting first touch:', err);
      toast.error(err.message || 'Erro ao resetar primeira interação');
    } finally {
      setResettingFirstTouch(false);
      setResetFirstTouchOpen(false);
      setResetAlsoDeleteLead(false);
    }
  };

  const handleCheckFirstTouchStatus = async () => {
    if (!selectedThread || !profile?.organization_id) return;
    setFtStatusLoading(true);
    setFtStatusData(null);
    setFtStatusOpen(true);
    try {
      const resp = await fetch(
        `https://tapbwlmdvluqdgvixkxf.supabase.co/functions/v1/reset-first-touch?organization_id=${encodeURIComponent(profile.organization_id)}&phone=${encodeURIComponent(selectedThread.contact_phone)}`,
        {
          headers: {
            apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhcGJ3bG1kdmx1cWRndml4a3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2MDY0NDgsImV4cCI6MjA3MDE4MjQ0OH0.U2p9jneQ6Lcgu672Z8W-KnKhLgMLygDk1jB4a0YIwvQ',
          },
        }
      );
      const data = await resp.json();
      setFtStatusData(data);
    } catch (err: any) {
      setFtStatusData({ ok: false, error: err.message });
    } finally {
      setFtStatusLoading(false);
    }
  };

  const filters: { key: string; label: string; adminOnly?: boolean }[] = [
    { key: 'all', label: 'Todas', adminOnly: true },
    { key: 'mine', label: 'Minhas' },
    { key: 'unassigned', label: 'Não atribuídas', adminOnly: true },
  ];

  const selectedContact = selectedThread ? getContactDisplay(selectedThread) : null;
  const assignedMemberName = selectedThread?.assigned_to
    ? memberNameMap[selectedThread.assigned_to]
    : null;

  const totalUnread = threads.reduce((sum, t) => sum + (t.unread_count || 0), 0);

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background">
      {/* ── Left Panel: Conversation List ── */}
      <div
        className={cn(
          'w-full md:w-80 lg:w-96 border-r border-border flex flex-col bg-card/50',
          selectedThreadId && 'hidden md:flex'
        )}
      >
        {/* Header */}
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Inbox</h2>
            <div className="flex items-center gap-2">
              {totalUnread > 0 && (
                <Badge className="bg-primary text-primary-foreground text-xs">
                  {totalUnread}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {threads.length} conversas
              </Badge>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm bg-background"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-1">
            {filters
              .filter((f) => !f.adminOnly || isAdmin)
              .map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant={filter === f.key ? 'default' : 'ghost'}
                  className="h-7 text-xs px-2.5 rounded-full"
                  onClick={() => setFilter(f.key as any)}
                >
                  {f.label}
                </Button>
              ))}
          </div>
        </div>

        {/* Thread List */}
        <ScrollArea className="flex-1">
          {loadingThreads ? (
            <div className="p-3 space-y-1">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-start gap-3 p-3">
                  <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : threads.length === 0 ? (
            <EmptyThreadList />
          ) : (
            threads.map((thread) => (
              <ThreadItem
                key={thread.id}
                thread={thread}
                selected={thread.id === selectedThreadId}
                onClick={() => selectThread(thread.id)}
                assignedName={thread.assigned_to ? memberNameMap[thread.assigned_to] : undefined}
              />
            ))
          )}
        </ScrollArea>
      </div>

      {/* ── Right Panel: Chat ── */}
      <div
        className={cn(
          'flex-1 flex flex-col',
          !selectedThreadId && 'hidden md:flex'
        )}
      >
        {!selectedThread ? (
          <EmptyChat />
        ) : (
          <>
            {/* Chat Header */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-card/50">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-8 w-8"
                onClick={() => selectThread('')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>

              <Avatar className="h-9 w-9">
                {selectedThread.profile_picture_url && (
                  <AvatarImage src={selectedThread.profile_picture_url} alt={selectedContact?.name || ''} />
                )}
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                  {getInitials(selectedContact?.name || '?')}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm truncate">
                  {selectedContact?.name}
                </h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {selectedContact?.subtitle && (
                    <>
                      <Phone className="h-3 w-3" />
                      <span>{selectedContact.subtitle}</span>
                      <span className="text-border">•</span>
                    </>
                  )}
                  <span className={assignedMemberName ? '' : 'text-destructive'}>
                    {assignedMemberName || 'Não atribuída'}
                  </span>
                </div>
              </div>

              {/* AI mode toggle (OFF → ASSISTED → AUTO → OFF) */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={selectedThread.ai_mode !== 'off' ? 'default' : 'outline'}
                    size="sm"
                    className={cn(
                      "h-7 text-xs gap-1",
                      selectedThread.ai_mode === 'auto' && 'bg-green-600 hover:bg-green-700 text-white'
                    )}
                  >
                    {selectedThread.ai_mode === 'auto' ? (
                      <Bot className="h-3.5 w-3.5" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {selectedThread.ai_mode === 'auto' ? 'AUTO' : selectedThread.ai_mode === 'assisted' ? 'Assistente' : 'IA Off'}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-1" align="end">
                  <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">Modo da IA</div>
                  {[
                    { mode: 'off', label: 'Desligada', icon: '⏸' },
                    { mode: 'assisted', label: 'Assistente', icon: '💡' },
                    { mode: 'auto', label: 'Autônoma', icon: '🤖' },
                  ].map(opt => (
                    <button
                      key={opt.mode}
                      className={cn(
                        'w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent transition-colors flex items-center gap-2',
                        selectedThread.ai_mode === opt.mode && 'bg-accent font-medium'
                      )}
                      onClick={() => toggleAiMode(selectedThread.id, opt.mode)}
                    >
                      <span>{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>

              {/* Lead action */}
              {selectedThread.lead_id ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => navigate(`/oportunidades?leadId=${selectedThread.lead_id}`)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Ver Lead
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => setCreateLeadModalOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Criar Lead
                </Button>
              )}

              {/* Assignment actions */}
              <div className="flex items-center gap-1">
                {selectedThread.assigned_to !== myProfileId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleAssign(myProfileId || null)}
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1" />
                    Assumir
                  </Button>
                )}

                {isAdmin && (
                  <Popover open={assignPopoverOpen} onOpenChange={setAssignPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                        <User className="h-3.5 w-3.5" />
                        Responsável
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-1" align="end">
                      <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                        Atribuir para
                      </div>
                      {orgMembers.map((member) => (
                        <button
                          key={member.id}
                          className={cn(
                            'w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent transition-colors flex items-center gap-2',
                            selectedThread.assigned_to === member.id && 'bg-accent font-medium'
                          )}
                          onClick={() => handleAssign(member.id)}
                        >
                          <Avatar className="h-5 w-5">
                            <AvatarFallback className="text-[9px] bg-muted">
                              {getInitials(member.name)}
                            </AvatarFallback>
                          </Avatar>
                          {member.name}
                          {member.id === myProfileId && (
                            <span className="text-[10px] text-muted-foreground ml-auto">(você)</span>
                          )}
                        </button>
                      ))}
                      {selectedThread.assigned_to && (
                        <>
                          <div className="border-t border-border my-1" />
                          <button
                            className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-destructive/10 text-destructive transition-colors flex items-center gap-2"
                            onClick={() => handleAssign(null)}
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                            Remover atribuição
                          </button>
                        </>
                      )}
                    </PopoverContent>
                  </Popover>
                )}

                {/* Reset First Touch (admin only) */}
                {isAdmin && (
                  <div className="flex items-center gap-0.5">
                    {firstTouchResetDone && (
                      <Badge variant="outline" className="h-5 text-[9px] font-medium border-emerald-500 text-emerald-600 dark:text-emerald-400 animate-pulse">
                        First-touch resetado — pronto para testar
                      </Badge>
                    )}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                            onClick={handleCheckFirstTouchStatus}
                          >
                            <Search className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Ver status first-touch</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                            onClick={() => setResetFirstTouchOpen(true)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Resetar First Touch</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
              </div>
            </div>

            {/* AI Auto Banner */}
            {selectedThread.ai_mode === 'auto' && (
              <div className={cn(
                'px-4 py-2 flex items-center justify-between text-xs border-b',
                selectedThread.ai_state === 'human_active'
                  ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                  : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
              )}>
                <div className="flex items-center gap-1.5">
                  {selectedThread.ai_state === 'human_active' ? (
                    <>
                      <Pause className="h-3.5 w-3.5" />
                      <span className="font-medium">Humano assumiu — IA pausada</span>
                    </>
                  ) : (
                    <>
                      <Bot className="h-3.5 w-3.5" />
                      <span className="font-medium">IA Autônoma ativa</span>
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-200 dark:bg-emerald-800/50 text-emerald-800 dark:text-emerald-300 text-[10px] font-semibold">SLA 10-40s</span>
                      {lastBlockedJob && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-[10px] cursor-help">
                                <AlertCircle className="h-3 w-3" />
                                {BLOCK_REASON_LABELS[(lastBlockedJob.result as any)?.block_reason] || lastBlockedJob.error || 'Bloqueada'}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs text-xs">
                              <p className="font-medium mb-1">Último bloqueio da IA:</p>
                              <p>{lastBlockedJob.error}</p>
                              {(lastBlockedJob.result as any)?.seconds_remaining && (
                                <p className="mt-1 text-muted-foreground">Aguardando {(lastBlockedJob.result as any).seconds_remaining}s</p>
                              )}
                              {(lastBlockedJob.result as any)?.ai_reply_count_since_last_lead !== undefined && (
                                <p className="mt-1 text-muted-foreground">Respostas sem retorno: {(lastBlockedJob.result as any).ai_reply_count_since_last_lead}</p>
                              )}
                              <p className="mt-1 text-muted-foreground/60">{lastBlockedJob.processed_at ? format(parseISO(lastBlockedJob.processed_at), 'HH:mm:ss') : ''}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </>
                  )}
                </div>
                {selectedThread.ai_state === 'human_active' ? (
                  <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => resumeAi(selectedThread.id)}>
                    <Play className="h-3 w-3" /> Retomar IA
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => toggleAiMode(selectedThread.id, 'off')}>
                    <Pause className="h-3 w-3" /> Pausar
                  </Button>
                )}
              </div>
            )}

            {/* Conversation Intelligence Badge */}
            {profile?.organization_id && (
              <ConversationIntelligenceBadge
                conversationId={selectedThread.id}
                organizationId={profile.organization_id}
              />
            )}

            {/* Messages */}
            <ScrollArea className="flex-1 px-4 py-2 relative" ref={scrollAreaRef} onScrollCapture={handleScroll}>
              {loadingMessages ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <MessageSquare className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">Nenhuma mensagem nesta conversa</p>
                </div>
              ) : (
                <MessagesList messages={messages} />
              )}

              {/* AI Thinking Indicator */}
              {selectedThread.ai_mode === 'auto' && selectedThread.ai_pending && (
                <AiThinkingIndicator startedAt={selectedThread.ai_pending_started_at} />
              )}

              <div ref={messagesEndRef} />
            </ScrollArea>

            {/* New messages indicator */}
            {newMsgCount > 0 && (
              <div className="absolute bottom-36 left-1/2 -translate-x-1/2 z-10">
                <Button
                  size="sm"
                  className="rounded-full shadow-lg gap-1.5 text-xs"
                  onClick={scrollToBottom}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  {newMsgCount} nova{newMsgCount > 1 ? 's' : ''} mensage{newMsgCount > 1 ? 'ns' : 'm'}
                </Button>
              </div>
            )}

            {/* AI Suggestion Panel */}
            {selectedThread.ai_mode === 'assisted' && profile?.organization_id && (
              <AiSuggestionPanel
                conversationId={selectedThread.id}
                organizationId={profile.organization_id}
                aiMode={selectedThread.ai_mode}
                onUseSuggestion={(text) => setMessageText(text)}
                onStageApplied={() => refreshThreads()}
              />
            )}

            {/* Send Bar */}
            <div className="p-3 border-t border-border bg-card/30">
              {canSend ? (
                <div className="flex items-end gap-2">
                  <Textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Digite sua mensagem..."
                    className="min-h-[40px] max-h-[120px] resize-none text-sm bg-background"
                    rows={1}
                  />
                  {messageText.trim() ? (
                    <Button
                      size="icon"
                      onClick={handleSend}
                      disabled={!messageText.trim() || sending}
                      className="h-10 w-10 flex-shrink-0 rounded-full"
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  ) : (
                    profile?.organization_id && (
                      <AudioRecorder
                        organizationId={profile.organization_id}
                        conversationId={selectedThread.id}
                        onAudioSent={() => {}}
                        disabled={sending}
                      />
                    )
                  )}
                </div>
              ) : (
                <div className="text-center py-2">
                  <p className="text-xs text-muted-foreground">
                    Esta conversa não está atribuída a você. Clique em <strong>Assumir</strong> para responder.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create Lead from Inbox Modal */}
      {selectedThread && (
        <CreateLeadFromInboxModal
          open={createLeadModalOpen}
          onOpenChange={setCreateLeadModalOpen}
          contactName={selectedThread.contact_name}
          contactPhone={selectedThread.contact_phone}
          onSave={(data) => createLeadFromConversation(selectedThread.id, data)}
        />
      )}

      {/* Reset First Touch Dialog */}
      <AlertDialog open={resetFirstTouchOpen} onOpenChange={setResetFirstTouchOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resetar Primeira Interação</AlertDialogTitle>
            <AlertDialogDescription>
              Isso vai permitir que a automação de primeira mensagem dispare novamente para este contato. O histórico de mensagens será mantido.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {selectedThread?.lead_id && (
            <div className="flex items-center space-x-2 py-2">
              <Checkbox
                id="delete-lead"
                checked={resetAlsoDeleteLead}
                onCheckedChange={(checked) => setResetAlsoDeleteLead(checked === true)}
              />
              <label htmlFor="delete-lead" className="text-sm text-muted-foreground cursor-pointer flex items-center gap-1.5">
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                Também deletar o lead vinculado
              </label>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={resettingFirstTouch}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetFirstTouch}
              disabled={resettingFirstTouch}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resettingFirstTouch ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Resetar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* First Touch Status Dialog */}
      <AlertDialog open={ftStatusOpen} onOpenChange={setFtStatusOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Status First-Touch</AlertDialogTitle>
            <AlertDialogDescription>
              Telefone: <code className="bg-muted px-1 py-0.5 rounded text-xs">{selectedThread?.contact_phone}</code>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-2">
            {ftStatusLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Consultando...
              </div>
            ) : ftStatusData ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Existe first-touch?</span>
                  <Badge variant={ftStatusData.exists ? 'default' : 'secondary'}>
                    {ftStatusData.exists ? 'SIM' : 'NÃO'}
                  </Badge>
                </div>
                {ftStatusData.rows && ftStatusData.rows.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">Registros encontrados:</p>
                    <div className="bg-muted/50 rounded p-2 space-y-1 max-h-32 overflow-auto">
                      {ftStatusData.rows.map((row: any, i: number) => (
                        <div key={i} className="text-[11px] font-mono text-foreground/80">
                          <span className="text-muted-foreground">ID:</span> {row.id?.substring(0, 8)}… | 
                          <span className="text-muted-foreground"> Criado:</span> {row.created_at ? new Date(row.created_at).toLocaleString('pt-BR') : '—'}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {ftStatusData.error && (
                  <p className="text-xs text-destructive">Erro: {ftStatusData.error}</p>
                )}
              </div>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Fechar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setFtStatusOpen(false);
                setResetFirstTouchOpen(true);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!ftStatusData?.exists}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Resetar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
