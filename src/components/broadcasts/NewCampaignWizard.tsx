import React, { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ArrowLeft, ArrowRight, Upload, Check, Loader2, FileSpreadsheet,
  Zap, Users, MessageSquare, Search, Calendar, Info,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBroadcasts } from '@/hooks/useBroadcasts';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ─── Types ───────────────────────────────────────────────────────────────────
interface ParsedRow {
  phone: string;
  name?: string;
  variables?: Record<string, any>;
}

interface Props {
  onClose: () => void;
}

type SourceType = 'spreadsheet' | 'crm_leads' | 'inbox';

interface CrmFilters {
  period: 'today' | '7d' | '30d' | 'custom';
  dateFrom: string;
  dateTo: string;
  pipelineId: string;
  stageIds: string[];
  source: string;
  sellerId: string;
}

interface InboxFilters {
  status: string;
  sellerId: string;
}

// ─── Phone normalization ──────────────────────────────────────────────────────
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length < 10) return null;
  return digits;
}

// ─── Source selection card ────────────────────────────────────────────────────
function SourceCard({
  icon, title, description, selected, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
        selected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/40 hover:bg-muted/30'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${selected ? 'text-primary' : 'text-muted-foreground'}`}>{icon}</div>
        <div>
          <div className="font-medium text-sm">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        </div>
        {selected && <Check className="ml-auto h-4 w-4 text-primary shrink-0" />}
      </div>
    </button>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────
export function NewCampaignWizard({ onClose }: Props) {
  const { orgId, profile } = useAuth();
  const { createCampaign } = useBroadcasts();
  const [step, setStep] = useState(1);
  const [sourceType, setSourceType] = useState<SourceType>('spreadsheet');

  // ── Step 1: Spreadsheet state ──
  const [allRawData, setAllRawData] = useState<Record<string, any>[]>([]);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawPreview, setRawPreview] = useState<Record<string, any>[]>([]);
  const [phoneCol, setPhoneCol] = useState('');
  const [nameCol, setNameCol] = useState('');
  const [fileName, setFileName] = useState('');

  // ── Step 1: CRM leads state ──
  const [crmFilters, setCrmFilters] = useState<CrmFilters>({
    period: '30d',
    dateFrom: '',
    dateTo: '',
    pipelineId: '',
    stageIds: [],
    source: 'all',
    sellerId: 'all',
  });
  const [crmLeads, setCrmLeads] = useState<any[]>([]);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmSearched, setCrmSearched] = useState(false);

  // ── Step 1: Inbox state ──
  const [inboxFilters, setInboxFilters] = useState<InboxFilters>({ status: 'all', sellerId: 'all' });
  const [inboxContacts, setInboxContacts] = useState<any[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxSearched, setInboxSearched] = useState(false);

  // ── Resolved recipients (goes into step 2+) ──
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [discarded, setDiscarded] = useState(0);
  const [duplicates, setDuplicates] = useState(0);

  // ── Step 2 state ──
  const [campaignName, setCampaignName] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [payloadType, setPayloadType] = useState<'text' | 'interactive' | 'image' | 'audio'>('text');
  const [buttons, setButtons] = useState<Array<{ label: string; value: string }>>([]);
  const [messageText, setMessageText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [minDelay, setMinDelay] = useState(20);
  const [maxDelay, setMaxDelay] = useState(60);
  const [limitPerHour, setLimitPerHour] = useState(80);
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('18:00');
  const [noDuplicate, setNoDuplicate] = useState(true);
  const [enableAutomation, setEnableAutomation] = useState(false);
  const [selectedAutomationId, setSelectedAutomationId] = useState('');
  const [responseWindowHours, setResponseWindowHours] = useState(24);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');

  // ── Remote data ──
  const { data: instances } = useQuery({
    queryKey: ['whatsapp-instances', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from('whatsapp_integrations')
        .select('instance_name, status')
        .eq('organization_id', orgId!);
      return data || [];
    },
  });

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines-for-broadcast', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from('pipelines')
        .select('id, name')
        .eq('organization_id', orgId!)
        .order('name');
      return data || [];
    },
  });

  const { data: allStages } = useQuery({
    queryKey: ['stages-for-broadcast', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from('pipeline_stages')
        .select('id, name, pipeline_id')
        .eq('organization_id', orgId!);
      return data || [];
    },
  });

  const { data: sellers } = useQuery({
    queryKey: ['sellers-for-broadcast', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, name')
        .eq('organization_id', orgId!)
        .order('name');
      return data || [];
    },
  });

  const { data: automations } = useQuery({
    queryKey: ['automations-for-broadcast', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/automations-api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', organization_id: orgId }),
      });
      const json = await res.json();
      return (json?.automations || []) as Array<{ id: string; name: string; is_active: boolean }>;
    },
  });

  // ── Spreadsheet handler ──
  const handleFileComplete = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (json.length === 0) return;

    const headers = Object.keys(json[0]);
    setRawHeaders(headers);
    setRawPreview(json.slice(0, 20));
    setAllRawData(json);

    const phoneCandidates = headers.filter(h => /phone|telefone|celular|whatsapp|numero|número|fone/i.test(h));
    const nameCandidates = headers.filter(h => /name|nome|cliente/i.test(h));
    if (phoneCandidates.length > 0) setPhoneCol(phoneCandidates[0]);
    if (nameCandidates.length > 0) setNameCol(nameCandidates[0]);
  }, []);

  const buildRecipientsFromSpreadsheet = useCallback((): ParsedRow[] => {
    const seen = new Set<string>();
    const valid: ParsedRow[] = [];
    let disc = 0;
    let dups = 0;

    for (const row of allRawData) {
      const rawPhone = String(row[phoneCol] || '');
      const normalized = normalizePhone(rawPhone);
      if (!normalized) { disc++; continue; }
      if (seen.has(normalized)) { dups++; continue; }
      seen.add(normalized);

      const name = nameCol && nameCol !== '__none__' ? String(row[nameCol] || '') : undefined;
      const variables: Record<string, any> = {};
      for (const h of rawHeaders) {
        if (h !== phoneCol && h !== nameCol) variables[h] = row[h];
      }
      valid.push({
        phone: normalized,
        name: name || undefined,
        variables: Object.keys(variables).length > 0 ? variables : undefined,
      });
    }

    setDiscarded(disc);
    setDuplicates(dups);
    return valid;
  }, [phoneCol, nameCol, allRawData, rawHeaders]);

  // ── CRM leads search ──
  const searchCrmLeads = async () => {
    if (!orgId) return;
    setCrmLoading(true);
    setCrmSearched(true);
    try {
      let q = (supabase as any)
        .from('leads')
        .select('id, name, phone, source, created_at, stage_id, assigned_to')
        .eq('organization_id', orgId)
        .not('phone', 'is', null)
        .neq('phone', '');

      // Period filter
      const now = new Date();
      if (crmFilters.period === 'today') {
        q = q.gte('created_at', new Date(now.setHours(0, 0, 0, 0)).toISOString());
      } else if (crmFilters.period === '7d') {
        q = q.gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
      } else if (crmFilters.period === '30d') {
        q = q.gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString());
      } else if (crmFilters.period === 'custom' && crmFilters.dateFrom) {
        q = q.gte('created_at', crmFilters.dateFrom);
        if (crmFilters.dateTo) q = q.lte('created_at', crmFilters.dateTo + 'T23:59:59');
      }

      // Stage filter
      if (crmFilters.stageIds.length > 0) {
        q = q.in('stage_id', crmFilters.stageIds);
      }

      // Source filter
      if (crmFilters.source && crmFilters.source !== 'all') {
        q = q.ilike('source', `%${crmFilters.source}%`);
      }

      // Seller filter
      if (crmFilters.sellerId && crmFilters.sellerId !== 'all') {
        if (crmFilters.sellerId === 'none') {
          q = q.is('assigned_to', null);
        } else {
          q = q.eq('assigned_to', crmFilters.sellerId);
        }
      }

      q = q.limit(2000).order('created_at', { ascending: false });

      const { data } = await q;
      setCrmLeads(data || []);
    } catch (err) {
      console.error('Error fetching CRM leads:', err);
      setCrmLeads([]);
    } finally {
      setCrmLoading(false);
    }
  };

  // ── Inbox contacts search ──
  const searchInboxContacts = async () => {
    if (!orgId) return;
    setInboxLoading(true);
    setInboxSearched(true);
    try {
      let q = (supabase as any)
        .from('conversations')
        .select('id, contact_phone, contact_name, status, assigned_to')
        .eq('organization_id', orgId)
        .not('contact_phone', 'is', null)
        .neq('contact_phone', '');

      if (inboxFilters.status !== 'all') q = q.eq('status', inboxFilters.status);
      if (inboxFilters.sellerId !== 'all') {
        if (inboxFilters.sellerId === 'none') {
          q = q.is('assigned_to', null);
        } else {
          q = q.eq('assigned_to', inboxFilters.sellerId);
        }
      }

      q = q.limit(2000).order('last_message_at', { ascending: false });
      const { data } = await q;
      setInboxContacts(data || []);
    } catch (err) {
      console.error('Error fetching inbox contacts:', err);
      setInboxContacts([]);
    } finally {
      setInboxLoading(false);
    }
  };

  // ── Build rows for CRM leads ──
  const buildRecipientsFromCrm = (): ParsedRow[] => {
    const seen = new Set<string>();
    const valid: ParsedRow[] = [];
    for (const lead of crmLeads) {
      const normalized = normalizePhone(String(lead.phone || ''));
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      const nameParts = (lead.name || '').trim().split(' ');
      valid.push({
        phone: normalized,
        name: lead.name || undefined,
        variables: {
          nome: nameParts[0] || '',
          nome_completo: lead.name || '',
          origem: lead.source || '',
          data_cadastro: lead.created_at
            ? format(new Date(lead.created_at), 'dd/MM/yyyy', { locale: ptBR })
            : '',
        },
      });
    }
    return valid;
  };

  // ── Build rows for inbox ──
  const buildRecipientsFromInbox = (): ParsedRow[] => {
    const seen = new Set<string>();
    const valid: ParsedRow[] = [];
    for (const conv of inboxContacts) {
      const normalized = normalizePhone(String(conv.contact_phone || ''));
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      const nameParts = (conv.contact_name || '').trim().split(' ');
      valid.push({
        phone: normalized,
        name: conv.contact_name || undefined,
        variables: {
          nome: nameParts[0] || '',
          nome_completo: conv.contact_name || '',
        },
      });
    }
    return valid;
  };

  // ── Transition to step 2 ──
  const goToStep2 = () => {
    let built: ParsedRow[] = [];
    if (sourceType === 'spreadsheet') {
      built = buildRecipientsFromSpreadsheet();
    } else if (sourceType === 'crm_leads') {
      built = buildRecipientsFromCrm();
      setDiscarded(0);
      setDuplicates(crmLeads.length - built.length);
    } else {
      built = buildRecipientsFromInbox();
      setDiscarded(0);
      setDuplicates(inboxContacts.length - built.length);
    }
    setRows(built);
    setStep(2);
  };

  const canGoToStep2 = () => {
    if (sourceType === 'spreadsheet') return !!phoneCol && allRawData.length > 0;
    if (sourceType === 'crm_leads') return crmSearched && crmLeads.length > 0;
    return inboxSearched && inboxContacts.length > 0;
  };

  const handleCreate = async () => {
    if (!profile) return;
    const payload = payloadType === 'text' || payloadType === 'interactive'
      ? { text: messageText }
      : { media_url: mediaUrl, caption };

    await createCampaign.mutateAsync({
      name: campaignName,
      instance_name: instanceName,
      payload_type: payloadType,
      payload,
      settings: { minDelay, maxDelay, limitPerHour, windowStart, windowEnd, noDuplicate },
      recipients: rows,
      profileId: profile.id,
      enableAutomation,
      automationId: enableAutomation ? selectedAutomationId || null : null,
      responseWindowHours,
      buttons: payloadType === 'interactive' ? buttons.filter(b => b.label && b.value) : null,
      sourceType,
      sourceFilters: sourceType !== 'spreadsheet'
        ? (sourceType === 'crm_leads' ? (crmFilters as any) : (inboxFilters as any))
        : null,
      scheduledAt: scheduleMode === 'later' && scheduledAt ? scheduledAt : null,
    });
    onClose();
  };

  const availableVars = sourceType === 'spreadsheet'
    ? (nameCol ? ['nome', ...rawHeaders.filter(h => h !== phoneCol && h !== nameCol)] : rawHeaders.filter(h => h !== phoneCol))
    : ['nome', 'nome_completo', 'origem', ...(sourceType === 'crm_leads' ? ['data_cadastro'] : [])];

  const stagesForPipeline = crmFilters.pipelineId
    ? (allStages || []).filter(s => s.pipeline_id === crmFilters.pipelineId)
    : [];

  const step2Valid = !!campaignName && !!instanceName
    && ((payloadType === 'text' || payloadType === 'interactive') ? !!messageText : !!mediaUrl)
    && (payloadType === 'interactive' ? buttons.filter(b => b.label && b.value).length > 0 : true)
    && (scheduleMode === 'later' ? !!scheduledAt : true);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-poppins">
            Nova Campanha — Passo {step} de 3
          </DialogTitle>
        </DialogHeader>

        {/* ══════ STEP 1: DESTINATÁRIOS ══════ */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <Label className="text-sm font-medium mb-3 block">De onde vêm os destinatários?</Label>
              <div className="space-y-2">
                <SourceCard
                  icon={<FileSpreadsheet className="h-5 w-5" />}
                  title="Planilha (CSV/XLSX)"
                  description="Faça upload de uma planilha com telefones e dados"
                  selected={sourceType === 'spreadsheet'}
                  onClick={() => setSourceType('spreadsheet')}
                />
                <SourceCard
                  icon={<Users className="h-5 w-5" />}
                  title="Leads do CRM"
                  description="Selecione leads com filtros de estágio, origem, período e vendedor"
                  selected={sourceType === 'crm_leads'}
                  onClick={() => setSourceType('crm_leads')}
                />
                <SourceCard
                  icon={<MessageSquare className="h-5 w-5" />}
                  title="Contatos do Inbox"
                  description="Use contatos que já têm conversa no WhatsApp"
                  selected={sourceType === 'inbox'}
                  onClick={() => setSourceType('inbox')}
                />
              </div>
            </div>

            {/* ── Spreadsheet source ── */}
            {sourceType === 'spreadsheet' && (
              <div className="space-y-4">
                <div>
                  <Label>Arquivo CSV ou XLSX</Label>
                  <div className="mt-2">
                    <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer hover:border-primary/50 transition-colors">
                      {fileName ? (
                        <div className="flex items-center gap-2 text-sm">
                          <FileSpreadsheet className="h-5 w-5 text-primary" />
                          <span className="font-medium">{fileName}</span>
                          <Badge variant="secondary">{allRawData.length} linhas</Badge>
                        </div>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                          <span className="text-sm text-muted-foreground">Clique para selecionar arquivo</span>
                        </>
                      )}
                      <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileComplete} />
                    </label>
                  </div>
                </div>

                {rawHeaders.length > 0 && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Coluna de Telefone *</Label>
                        <Select value={phoneCol} onValueChange={setPhoneCol}>
                          <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                          <SelectContent>
                            {rawHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Coluna de Nome (opcional)</Label>
                        <Select value={nameCol} onValueChange={setNameCol}>
                          <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Nenhuma</SelectItem>
                            {rawHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="mb-2 block">Preview (primeiras 20 linhas)</Label>
                      <div className="border rounded-md overflow-auto max-h-[180px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {rawHeaders.slice(0, 5).map(h => (
                                <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rawPreview.map((row, i) => (
                              <TableRow key={i}>
                                {rawHeaders.slice(0, 5).map(h => (
                                  <TableCell key={h} className="text-xs py-1">{String(row[h] || '')}</TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── CRM Leads source ── */}
            {sourceType === 'crm_leads' && (
              <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
                <p className="text-sm font-medium">Filtros de segmentação</p>

                {/* Period */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Período de criação</Label>
                  <div className="flex gap-2 flex-wrap">
                    {(['today', '7d', '30d', 'custom'] as const).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCrmFilters(f => ({ ...f, period: p }))}
                        className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                          crmFilters.period === p
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        {p === 'today' ? 'Hoje' : p === '7d' ? 'Últimos 7 dias' : p === '30d' ? 'Últimos 30 dias' : 'Personalizado'}
                      </button>
                    ))}
                  </div>
                  {crmFilters.period === 'custom' && (
                    <div className="flex gap-2 mt-2">
                      <div>
                        <Label className="text-xs">De</Label>
                        <Input type="date" value={crmFilters.dateFrom} onChange={e => setCrmFilters(f => ({ ...f, dateFrom: e.target.value }))} className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label className="text-xs">Até</Label>
                        <Input type="date" value={crmFilters.dateTo} onChange={e => setCrmFilters(f => ({ ...f, dateTo: e.target.value }))} className="h-8 text-xs" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Pipeline + Stages */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Pipeline</Label>
                    <Select
                      value={crmFilters.pipelineId || '__all__'}
                      onValueChange={v => setCrmFilters(f => ({ ...f, pipelineId: v === '__all__' ? '' : v, stageIds: [] }))}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Todos os pipelines</SelectItem>
                        {(pipelines || []).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Estágio</Label>
                    {stagesForPipeline.length > 0 ? (
                      <div className="border rounded-md p-2 max-h-28 overflow-y-auto space-y-1">
                        {stagesForPipeline.map(s => (
                          <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer">
                            <Checkbox
                              checked={crmFilters.stageIds.includes(s.id)}
                              onCheckedChange={checked => {
                                setCrmFilters(f => ({
                                  ...f,
                                  stageIds: checked
                                    ? [...f.stageIds, s.id]
                                    : f.stageIds.filter(id => id !== s.id),
                                }));
                              }}
                            />
                            {s.name}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">Selecione um pipeline</p>
                    )}
                  </div>
                </div>

                {/* Source + Seller */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Origem do lead</Label>
                    <Select value={crmFilters.source} onValueChange={v => setCrmFilters(f => ({ ...f, source: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as origens</SelectItem>
                        <SelectItem value="Meta Ads">Meta Ads</SelectItem>
                        <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                        <SelectItem value="OLX">OLX</SelectItem>
                        <SelectItem value="Webmotors">Webmotors</SelectItem>
                        <SelectItem value="Indicação">Indicação</SelectItem>
                        <SelectItem value="Site">Site</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Responsável</Label>
                    <Select value={crmFilters.sellerId} onValueChange={v => setCrmFilters(f => ({ ...f, sellerId: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os vendedores</SelectItem>
                        <SelectItem value="none">Sem responsável</SelectItem>
                        {(sellers || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button onClick={searchCrmLeads} disabled={crmLoading} className="w-full gap-2">
                  {crmLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {crmLoading ? 'Buscando...' : 'Buscar Leads'}
                </Button>

                {crmSearched && !crmLoading && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-emerald-600">
                        {crmLeads.length} leads encontrados
                      </span>
                      {crmLeads.length === 0 && (
                        <span className="text-xs text-muted-foreground">Tente outros filtros</span>
                      )}
                    </div>
                    {crmLeads.length > 0 && (
                      <div className="border rounded-md overflow-auto max-h-[180px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Nome</TableHead>
                              <TableHead className="text-xs">Telefone</TableHead>
                              <TableHead className="text-xs">Origem</TableHead>
                              <TableHead className="text-xs">Cadastrado em</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {crmLeads.slice(0, 10).map(lead => (
                              <TableRow key={lead.id}>
                                <TableCell className="text-xs py-1">{lead.name || '—'}</TableCell>
                                <TableCell className="text-xs py-1 font-mono">{lead.phone}</TableCell>
                                <TableCell className="text-xs py-1">{lead.source || '—'}</TableCell>
                                <TableCell className="text-xs py-1">
                                  {lead.created_at
                                    ? format(new Date(lead.created_at), 'dd/MM/yy', { locale: ptBR })
                                    : '—'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {crmLeads.length > 10 && (
                          <p className="text-xs text-center text-muted-foreground py-2">
                            ... e mais {crmLeads.length - 10} leads
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Inbox contacts source ── */}
            {sourceType === 'inbox' && (
              <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
                <p className="text-sm font-medium">Filtros de contatos</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Status da conversa</Label>
                    <Select value={inboxFilters.status} onValueChange={v => setInboxFilters(f => ({ ...f, status: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="open">Abertos</SelectItem>
                        <SelectItem value="in_progress">Em atendimento</SelectItem>
                        <SelectItem value="waiting_customer">Aguardando cliente</SelectItem>
                        <SelectItem value="closed">Finalizados</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Responsável</Label>
                    <Select value={inboxFilters.sellerId} onValueChange={v => setInboxFilters(f => ({ ...f, sellerId: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="none">Sem responsável</SelectItem>
                        {(sellers || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button onClick={searchInboxContacts} disabled={inboxLoading} className="w-full gap-2">
                  {inboxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {inboxLoading ? 'Buscando...' : 'Buscar Contatos'}
                </Button>

                {inboxSearched && !inboxLoading && (
                  <div>
                    <p className="text-sm font-medium text-emerald-600 mb-2">
                      {inboxContacts.length} contatos encontrados
                    </p>
                    {inboxContacts.length > 0 && (
                      <div className="border rounded-md overflow-auto max-h-[160px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Nome</TableHead>
                              <TableHead className="text-xs">Telefone</TableHead>
                              <TableHead className="text-xs">Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {inboxContacts.slice(0, 10).map(c => (
                              <TableRow key={c.id}>
                                <TableCell className="text-xs py-1">{c.contact_name || '—'}</TableCell>
                                <TableCell className="text-xs py-1 font-mono">{c.contact_phone}</TableCell>
                                <TableCell className="text-xs py-1">{c.status || '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {inboxContacts.length > 10 && (
                          <p className="text-xs text-center text-muted-foreground py-2">
                            ... e mais {inboxContacts.length - 10} contatos
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={goToStep2} disabled={!canGoToStep2()}>
                Próximo <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* ══════ STEP 2: MENSAGEM & CONFIGURAÇÕES ══════ */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <Label>Nome da campanha *</Label>
              <Input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="Ex: Retomada de leads frios" />
            </div>

            <div>
              <Label>Instância Evolution *</Label>
              <Select value={instanceName} onValueChange={setInstanceName}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {(instances || []).map(inst => (
                    <SelectItem key={inst.instance_name} value={inst.instance_name}>
                      {inst.instance_name} ({inst.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Tipo de disparo</Label>
              <Select value={payloadType} onValueChange={v => {
                setPayloadType(v as any);
                if (v === 'interactive' && buttons.length === 0) setButtons([{ label: '', value: '' }]);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Texto livre</SelectItem>
                  <SelectItem value="interactive">Texto com botões</SelectItem>
                  <SelectItem value="image">Imagem</SelectItem>
                  <SelectItem value="audio">Áudio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(payloadType === 'text' || payloadType === 'interactive') && (
              <div>
                <Label>Mensagem</Label>
                <Textarea
                  id="broadcast-message-textarea"
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  rows={5}
                  placeholder="Olá {{nome}}, tudo bem?"
                  onDrop={e => {
                    e.preventDefault();
                    const variable = e.dataTransfer.getData('text/plain');
                    if (!variable) return;
                    const textarea = e.currentTarget;
                    const start = textarea.selectionStart ?? messageText.length;
                    setMessageText(messageText.slice(0, start) + variable + messageText.slice(start));
                  }}
                  onDragOver={e => e.preventDefault()}
                />
                {availableVars.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <span className="text-xs text-muted-foreground mr-1">Variáveis:</span>
                    {availableVars.map(v => (
                      <span
                        key={v}
                        draggable
                        onDragStart={e => { e.dataTransfer.setData('text/plain', `{{${v}}}`); e.dataTransfer.effectAllowed = 'copy'; }}
                        onClick={() => {
                          const textarea = document.getElementById('broadcast-message-textarea') as HTMLTextAreaElement | null;
                          const pos = textarea?.selectionStart ?? messageText.length;
                          setMessageText(messageText.slice(0, pos) + `{{${v}}}` + messageText.slice(pos));
                          setTimeout(() => textarea?.focus(), 0);
                        }}
                        className="inline-flex items-center rounded-md border border-input bg-accent/50 px-2 py-0.5 text-xs font-medium cursor-grab active:cursor-grabbing hover:bg-accent transition-colors select-none"
                      >
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {payloadType === 'interactive' && (
              <div className="space-y-3 border border-border rounded-lg p-4 bg-muted/30">
                <Label className="font-medium">Botões (até 3)</Label>
                {buttons.map((btn, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                    <Input
                      placeholder="Texto do botão (ex: SIM)"
                      value={btn.label}
                      onChange={e => { const u = [...buttons]; u[idx] = { ...u[idx], label: e.target.value }; setButtons(u); }}
                    />
                    <Input
                      placeholder="Valor interno (ex: sim)"
                      value={btn.value}
                      onChange={e => { const u = [...buttons]; u[idx] = { ...u[idx], value: e.target.value }; setButtons(u); }}
                    />
                    <Button variant="ghost" size="sm" onClick={() => setButtons(buttons.filter((_, i) => i !== idx))} disabled={buttons.length <= 1}>✕</Button>
                  </div>
                ))}
                {buttons.length < 3 && (
                  <Button variant="outline" size="sm" onClick={() => setButtons([...buttons, { label: '', value: '' }])}>
                    + Adicionar botão
                  </Button>
                )}
              </div>
            )}

            {(payloadType === 'image' || payloadType === 'audio') && (
              <>
                <div>
                  <Label>URL da mídia</Label>
                  <Input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} placeholder="https://..." />
                </div>
                {payloadType === 'image' && (
                  <div>
                    <Label>Legenda (opcional)</Label>
                    <Textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} />
                  </div>
                )}
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Delay mínimo (seg)</Label>
                <Input type="number" value={minDelay} onChange={e => setMinDelay(+e.target.value)} />
              </div>
              <div>
                <Label>Delay máximo (seg)</Label>
                <Input type="number" value={maxDelay} onChange={e => setMaxDelay(+e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Limite/hora</Label>
                <Input type="number" value={limitPerHour} onChange={e => setLimitPerHour(+e.target.value)} />
              </div>
              <div>
                <Label>Janela início</Label>
                <Input type="time" value={windowStart} onChange={e => setWindowStart(e.target.value)} />
              </div>
              <div>
                <Label>Janela fim</Label>
                <Input type="time" value={windowEnd} onChange={e => setWindowEnd(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={noDuplicate} onCheckedChange={setNoDuplicate} />
              <Label>Não reenviar para o mesmo telefone nesta campanha</Label>
            </div>

            {/* Automation */}
            <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="flex items-center gap-3">
                <Switch checked={enableAutomation} onCheckedChange={setEnableAutomation} />
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <Label className="font-medium">Iniciar automação após resposta</Label>
                </div>
              </div>
              {enableAutomation && (
                <div className="space-y-2">
                  <Select value={selectedAutomationId} onValueChange={setSelectedAutomationId}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione uma automação..." /></SelectTrigger>
                    <SelectContent>
                      {(automations || []).map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div>
                    <Label className="text-sm">Janela de resposta (horas)</Label>
                    <Input
                      type="number" min={1} max={168}
                      value={responseWindowHours}
                      onChange={e => setResponseWindowHours(+e.target.value)}
                      className="mt-1 w-32"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Scheduling */}
            <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="flex items-center gap-3">
                <Switch
                  checked={scheduleMode === 'later'}
                  onCheckedChange={v => setScheduleMode(v ? 'later' : 'now')}
                />
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-purple-500" />
                  <Label className="font-medium">Agendar para depois</Label>
                </div>
              </div>
              {scheduleMode === 'later' && (
                <div>
                  <Label className="text-sm">Data e hora do disparo</Label>
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)}
                    className="mt-1 w-full"
                  />
                  <Alert className="mt-2">
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      A campanha será criada com status "Agendada". Para iniciar automaticamente no horário, é necessário configurar um cron job no Supabase que chame o broadcast-worker.
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
              </Button>
              <Button onClick={() => setStep(3)} disabled={!step2Valid}>
                Próximo <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* ══════ STEP 3: REVISÃO ══════ */}
        {step === 3 && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-2">
                {[
                  ['Campanha', campaignName],
                  ['Instância', instanceName],
                  ['Tipo', payloadType === 'text' ? 'Texto' : payloadType === 'interactive' ? 'Botões' : payloadType === 'image' ? 'Imagem' : 'Áudio'],
                  ['Fonte', sourceType === 'spreadsheet' ? 'Planilha' : sourceType === 'crm_leads' ? 'Leads CRM' : 'Inbox'],
                  ['Total válidos', rows.length],
                  ...(discarded > 0 ? [['Inválidos removidos', discarded]] : []),
                  ...(duplicates > 0 ? [['Duplicatas removidas', duplicates]] : []),
                  ['Delay', `${minDelay}s – ${maxDelay}s`],
                  ['Limite/hora', limitPerHour],
                  ['Janela', `${windowStart} – ${windowEnd}`],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    <span className="text-sm font-medium">{String(value)}</span>
                  </div>
                ))}
                {scheduleMode === 'later' && scheduledAt && (
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Agendado para</span>
                    <span className="text-sm font-medium text-purple-600">
                      {format(new Date(scheduledAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                )}
                {enableAutomation && selectedAutomationId && (
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Automação</span>
                    <Badge variant="secondary" className="gap-1">
                      <Zap className="h-3 w-3" />
                      {automations?.find(a => a.id === selectedAutomationId)?.name || 'Selecionada'}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {(payloadType === 'text' || payloadType === 'interactive') && (
              <Card>
                <CardContent className="p-4">
                  <Label className="text-xs text-muted-foreground">Preview da mensagem</Label>
                  <p className="text-sm mt-1 whitespace-pre-wrap bg-muted/50 rounded-lg p-3">{messageText}</p>
                  {payloadType === 'interactive' && buttons.filter(b => b.label).length > 0 && (
                    <div className="flex gap-2 mt-2">
                      {buttons.filter(b => b.label).map((b, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{b.label}</Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {rows.length === 0 && (
              <Alert variant="destructive">
                <AlertDescription>Nenhum destinatário válido encontrado. Volte e verifique a fonte.</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createCampaign.isPending || rows.length === 0}
              >
                {createCampaign.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : scheduleMode === 'later' ? (
                  <Calendar className="h-4 w-4 mr-2" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {scheduleMode === 'later' ? 'Agendar campanha' : 'Criar e iniciar'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
