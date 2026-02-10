import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useInbox, InboxThread, InboxMessage } from '@/hooks/useInbox';
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
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// ── Helpers ──

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Brazilian phone: 55 + DDD (2) + number (8-9)
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
            <User className="h-2.5 w-2.5 text-muted-foreground/60" />
            <span className={cn(
              'text-[10px]',
              assignedName ? 'text-muted-foreground/60' : 'text-orange-500/80'
            )}>
              {assignedName || 'Não atribuída'}
            </span>
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

  return (
    <div className={cn('flex mb-1.5', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
          isOutbound
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-card border border-border/50 rounded-bl-md',
          isOptimistic && 'opacity-70'
        )}
      >
        <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>
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
    setFilter,
    setSearch,
    selectThread,
    sendMessage,
    assignThread,
    canSendMessage,
  } = useInbox();

  const [messageText, setMessageText] = useState('');
  const [assignPopoverOpen, setAssignPopoverOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const canSend = canSendMessage(selectedThread);

  const memberNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    orgMembers.forEach((m) => { map[m.user_id] = m.name; });
    return map;
  }, [orgMembers]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  const handleAssign = async (userId: string | null) => {
    if (!selectedThread) return;
    setAssignPopoverOpen(false);
    await assignThread(selectedThread.id, userId);
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
                  <span className={assignedMemberName ? '' : 'text-orange-500'}>
                    {assignedMemberName || 'Não atribuída'}
                  </span>
                </div>
              </div>

              {/* Assignment actions */}
              <div className="flex items-center gap-1">
                {selectedThread.assigned_to !== profile?.user_id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleAssign(profile?.user_id || null)}
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
                            selectedThread.assigned_to === member.user_id && 'bg-accent font-medium'
                          )}
                          onClick={() => handleAssign(member.user_id)}
                        >
                          <Avatar className="h-5 w-5">
                            <AvatarFallback className="text-[9px] bg-muted">
                              {getInitials(member.name)}
                            </AvatarFallback>
                          </Avatar>
                          {member.name}
                          {member.user_id === profile?.user_id && (
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
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 px-4 py-2">
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
              <div ref={messagesEndRef} />
            </ScrollArea>

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
    </div>
  );
}
