import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Send, X, Loader2, Lightbulb } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AiSuggestion {
  intent: string;
  summary: string;
  suggested_reply: string;
  suggested_actions: string[];
  confidence: number;
}

interface AiSuggestionPanelProps {
  conversationId: string;
  organizationId: string;
  aiMode: string;
  onUseSuggestion: (text: string) => void;
}

const intentLabels: Record<string, string> = {
  interest: 'Interesse',
  question: 'Pergunta',
  objection: 'Objeção',
  complaint: 'Reclamação',
  closing: 'Fechamento',
  greeting: 'Saudação',
  other: 'Outro',
  unknown: 'Indefinido',
};

const actionLabels: Record<string, string> = {
  'move_stage:Andamento': 'Mover para Andamento',
  'move_stage:Qualificado': 'Mover para Qualificado',
  'move_stage:Proposta': 'Mover para Proposta',
  qualify_lead: 'Qualificar lead',
  schedule_followup: 'Agendar follow-up',
};

export function AiSuggestionPanel({
  conversationId,
  organizationId,
  aiMode,
  onUseSuggestion,
}: AiSuggestionPanelProps) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const [editedReply, setEditedReply] = useState('');
  const [showPanel, setShowPanel] = useState(false);

  if (aiMode === 'off') return null;

  const handleAnalyze = async () => {
    setLoading(true);
    setSuggestion(null);
    setShowPanel(true);

    try {
      const res = await supabase.functions.invoke('ai-analyze-conversation', {
        body: { conversation_id: conversationId, organization_id: organizationId },
      });

      if (res.error) throw new Error(res.error.message);
      const data = res.data as any;
      if (data?.error) throw new Error(data.error);

      setSuggestion(data as AiSuggestion);
      setEditedReply(data.suggested_reply || '');
    } catch (err: any) {
      console.error('AI analysis error:', err);
      toast.error(err.message || 'Erro ao analisar conversa');
      setShowPanel(false);
    } finally {
      setLoading(false);
    }
  };

  const handleUse = () => {
    if (editedReply.trim()) {
      onUseSuggestion(editedReply.trim());
      setShowPanel(false);
      setSuggestion(null);
    }
  };

  const handleClose = () => {
    setShowPanel(false);
    setSuggestion(null);
  };

  return (
    <>
      {/* Trigger button - shown when panel is closed */}
      {!showPanel && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleAnalyze}
          disabled={loading}
          className="h-7 text-xs gap-1 text-primary hover:text-primary"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Sugerir resposta (IA)
        </Button>
      )}

      {/* Suggestion panel */}
      {showPanel && (
        <div className="border-t border-border bg-muted/30 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-primary">Sugestão da IA</span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">Analisando conversa...</span>
            </div>
          ) : suggestion ? (
            <>
              {/* Intent + confidence */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] h-5">
                  <Lightbulb className="h-3 w-3 mr-1" />
                  {intentLabels[suggestion.intent] || suggestion.intent}
                </Badge>
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px] h-5",
                    suggestion.confidence >= 0.7 ? "bg-green-500/10 text-green-700" :
                    suggestion.confidence >= 0.4 ? "bg-yellow-500/10 text-yellow-700" :
                    "bg-red-500/10 text-red-700"
                  )}
                >
                  {Math.round(suggestion.confidence * 100)}% confiança
                </Badge>
              </div>

              {/* Summary */}
              <p className="text-xs text-muted-foreground italic">
                {suggestion.summary}
              </p>

              {/* Editable reply */}
              <Textarea
                value={editedReply}
                onChange={(e) => setEditedReply(e.target.value)}
                className="min-h-[60px] max-h-[100px] text-sm resize-none bg-background"
                placeholder="Edite a sugestão antes de usar..."
              />

              {/* Suggested actions (read-only) */}
              {suggestion.suggested_actions.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">Ações sugeridas:</span>
                  {suggestion.suggested_actions.map((action, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] h-5 bg-background">
                      {actionLabels[action] || action}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleUse} className="h-7 text-xs gap-1">
                  <Send className="h-3 w-3" />
                  Usar resposta
                </Button>
                <Button variant="ghost" size="sm" onClick={handleAnalyze} className="h-7 text-xs">
                  Regenerar
                </Button>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  Nenhuma ação é executada automaticamente
                </span>
              </div>
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
