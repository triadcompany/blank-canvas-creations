import React, { useState, useRef, useEffect } from 'react';
import { useInbox, InboxThread, InboxMessage } from '@/hooks/useInbox';
import { useAuth } from '@/contexts/AuthContext';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  MessageSquare,
  Send,
  Search,
  Phone,
  User,
  Clock,
  CheckCheck,
  ArrowLeft,
  Loader2,
  Inbox as InboxIcon,
  Filter,
  UserPlus,
  X,
  CircleDot,
  Circle,
  XCircle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ── Helpers ──

function formatMessageTime(dateStr: string) {
  const date = parseISO(dateStr);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Ontem ' + format(date, 'HH:mm');
  return format(date, 'dd/MM HH:mm');
}

function formatThreadTime(dateStr: string | null) {
  if (!dateStr) return '';
  const date = parseISO(dateStr);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Ontem';
  return format(date, 'dd/MM', { locale: ptBR });
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  open: { label: 'Aberta', color: 'bg-green-500/15 text-green-700 border-green-500/30', icon: CircleDot },
  pending: { label: 'Pendente', color: 'bg-amber-500/15 text-amber-700 border-amber-500/30', icon: Clock },
  closed: { label: 'Fechada', color: 'bg-muted text-muted-foreground border-border', icon: XCircle },
};

// ── Thread List Item ──

function ThreadItem({
  thread,
  selected,
  onClick,
}: {
  thread: InboxThread;
  selected: boolean;
  onClick: () => void;
}) {
  const status = statusConfig[thread.status] || statusConfig.open;
  const StatusIcon = status.icon;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 border-b border-border transition-colors',
        'hover:bg-accent/50',
        selected && 'bg-accent border-l-2 border-l-primary'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">
              {thread.contact_name || thread.contact_phone_e164}
            </span>
            <StatusIcon className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
          </div>
          {thread.contact_name && (
            <p className="text-xs text-muted-foreground truncate">
              {thread.contact_phone_e164}
            </p>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap mt-0.5">
          {formatThreadTime(thread.last_message_at)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1 truncate">
        {thread.last_message_preview || 'Sem mensagens'}
      </p>
      {thread.assigned_user_id && (
        <div className="flex items-center gap-1 mt-1.5">
          <User className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Atribuída</span>
        </div>
      )}
    </button>
  );
}

// ── Message Bubble ──

function MessageBubble({ message }: { message: InboxMessage }) {
  const isOutbound = message.direction === 'outbound';

  return (
    <div className={cn('flex mb-2', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm',
          isOutbound
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-muted rounded-bl-md'
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.message_text}</p>
        <div
          className={cn(
            'flex items-center justify-end gap-1 mt-1',
            isOutbound ? 'text-primary-foreground/60' : 'text-muted-foreground'
          )}
        >
          <span className="text-[10px]">{formatMessageTime(message.created_at)}</span>
          {isOutbound && <CheckCheck className="h-3 w-3" />}
        </div>
      </div>
    </div>
  );
}

// ── Empty States ──

function EmptyThreadList() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <InboxIcon className="h-12 w-12 text-muted-foreground/40 mb-3" />
      <p className="text-sm font-medium text-muted-foreground">Nenhuma conversa</p>
      <p className="text-xs text-muted-foreground/70 mt-1">
        As conversas aparecerão quando mensagens forem recebidas via WhatsApp
      </p>
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
      </div>
      <h3 className="font-medium text-foreground">Selecione uma conversa</h3>
      <p className="text-sm text-muted-foreground mt-1">
        Escolha uma conversa na lista para visualizar e responder
      </p>
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
    setFilter,
    setSearch,
    selectThread,
    sendMessage,
    updateThreadStatus,
  } = useInbox();

  const [messageText, setMessageText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!messageText.trim() || sending) return;
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

  const filters: { key: string; label: string; adminOnly?: boolean }[] = [
    { key: 'all', label: 'Todas', adminOnly: true },
    { key: 'mine', label: 'Minhas' },
    { key: 'unassigned', label: 'Não atribuídas', adminOnly: true },
  ];

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background">
      {/* ── Left Panel: Thread List ── */}
      <div
        className={cn(
          'w-full md:w-80 lg:w-96 border-r border-border flex flex-col',
          selectedThreadId && 'hidden md:flex'
        )}
      >
        {/* Header */}
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Inbox</h2>
            <Badge variant="outline" className="text-xs">
              {threads.length}
            </Badge>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm"
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
                  className="h-7 text-xs px-2.5"
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
            <div className="p-3 space-y-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="space-y-2 p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
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
            <div className="px-4 py-3 border-b border-border flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-8 w-8"
                onClick={() => selectThread('')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-sm truncate">
                    {selectedThread.contact_name || selectedThread.contact_phone_e164}
                  </h3>
                  {(() => {
                    const s = statusConfig[selectedThread.status] || statusConfig.open;
                    return (
                      <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', s.color)}>
                        {s.label}
                      </Badge>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  <span>{selectedThread.contact_phone_e164}</span>
                </div>
              </div>

              {/* Status actions */}
              <div className="flex gap-1">
                {selectedThread.status !== 'closed' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => updateThreadStatus(selectedThread.id, 'closed')}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    Fechar
                  </Button>
                )}
                {selectedThread.status === 'closed' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => updateThreadStatus(selectedThread.id, 'open')}
                  >
                    <CircleDot className="h-3.5 w-3.5 mr-1" />
                    Reabrir
                  </Button>
                )}
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              {loadingMessages ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <MessageSquare className="h-8 w-8 mb-2 opacity-40" />
                  <p className="text-sm">Nenhuma mensagem nesta conversa</p>
                </div>
              ) : (
                <>
                  {messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} />
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </ScrollArea>

            {/* Send Bar */}
            <div className="p-3 border-t border-border">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={textareaRef}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Digite sua mensagem..."
                  className="min-h-[40px] max-h-[120px] resize-none text-sm"
                  rows={1}
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!messageText.trim() || sending}
                  className="h-10 w-10 flex-shrink-0"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
