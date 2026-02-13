import React, { useState, useCallback } from 'react';
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
import { ArrowLeft, ArrowRight, Upload, Check, Loader2, FileSpreadsheet, Zap } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBroadcasts } from '@/hooks/useBroadcasts';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';

interface ParsedRow {
  phone: string;
  name?: string;
  variables?: Record<string, any>;
}

interface Props {
  onClose: () => void;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length < 12) return null;
  return '+' + digits;
}

export function NewCampaignWizard({ onClose }: Props) {
  const { orgId, profile } = useAuth();
  const { createCampaign } = useBroadcasts();
  const [step, setStep] = useState(1);

  // Step 1 state
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [phoneCol, setPhoneCol] = useState('');
  const [nameCol, setNameCol] = useState('');
  const [discarded, setDiscarded] = useState(0);
  const [duplicates, setDuplicates] = useState(0);
  const [fileName, setFileName] = useState('');
  const [rawPreview, setRawPreview] = useState<Record<string, any>[]>([]);

  // Step 2 state
  const [campaignName, setCampaignName] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [payloadType, setPayloadType] = useState<'text' | 'image' | 'audio'>('text');
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

  // Fetch WhatsApp instances
  const { data: instances, isLoading: instancesLoading } = useQuery({
    queryKey: ['whatsapp-instances', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whatsapp_integrations')
        .select('instance_name, status')
        .eq('organization_id', orgId!);
      if (error) console.error('Error fetching instances:', error);
      return data || [];
    },
  });

  // Fetch automations via automations-api (same pattern as useAutomations)
  const { data: automations } = useQuery({
    queryKey: ['automations-for-broadcast', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await fetch(`https://tapbwlmdvluqdgvixkxf.supabase.co/functions/v1/automations-api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', organization_id: orgId }),
      });
      const json = await res.json();
      return (json?.automations || []) as Array<{ id: string; name: string; is_active: boolean }>;
    },
  });

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    // Auto-detect phone and name columns
    const phoneCandidates = headers.filter(h =>
      /phone|telefone|celular|whatsapp|numero|número|fone/i.test(h)
    );
    const nameCandidates = headers.filter(h =>
      /name|nome|cliente/i.test(h)
    );
    if (phoneCandidates.length > 0) setPhoneCol(phoneCandidates[0]);
    if (nameCandidates.length > 0) setNameCol(nameCandidates[0]);
  }, []);

  const processRows = useCallback(() => {
    if (!phoneCol || rawPreview.length === 0) return;

    // Use full data from rawPreview parent (we stored only 20 for preview, but need full)
    // Re-parse... actually we stored rawPreview as first 20, but we need all rows.
    // Let's store all raw data
  }, [phoneCol, rawPreview]);

  // Actually store all raw data
  const [allRawData, setAllRawData] = useState<Record<string, any>[]>([]);

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

    const phoneCandidates = headers.filter(h =>
      /phone|telefone|celular|whatsapp|numero|número|fone/i.test(h)
    );
    const nameCandidates = headers.filter(h =>
      /name|nome|cliente/i.test(h)
    );
    if (phoneCandidates.length > 0) setPhoneCol(phoneCandidates[0]);
    if (nameCandidates.length > 0) setNameCol(nameCandidates[0]);
  }, []);

  const buildRecipients = useCallback(() => {
    if (!phoneCol) return;

    const seen = new Set<string>();
    const valid: ParsedRow[] = [];
    let disc = 0;
    let dups = 0;

    for (const row of allRawData) {
      const rawPhone = String(row[phoneCol] || '');
      const normalized = normalizePhone(rawPhone);
      if (!normalized) {
        disc++;
        continue;
      }
      if (seen.has(normalized)) {
        dups++;
        continue;
      }
      seen.add(normalized);

      const name = nameCol ? String(row[nameCol] || '') : undefined;
      const variables: Record<string, any> = {};
      for (const h of rawHeaders) {
        if (h !== phoneCol && h !== nameCol) {
          variables[h] = row[h];
        }
      }

      valid.push({
        phone: normalized,
        name: name || undefined,
        variables: Object.keys(variables).length > 0 ? variables : undefined,
      });
    }

    setRows(valid);
    setDiscarded(disc);
    setDuplicates(dups);
  }, [phoneCol, nameCol, allRawData, rawHeaders]);

  const goToStep2 = () => {
    buildRecipients();
    setStep(2);
  };

  const goToStep3 = () => {
    setStep(3);
  };

  const handleCreate = async () => {
    if (!profile) return;
    await createCampaign.mutateAsync({
      name: campaignName,
      instance_name: instanceName,
      payload_type: payloadType,
      payload: payloadType === 'text'
        ? { text: messageText }
        : { media_url: mediaUrl, caption },
      settings: {
        minDelay,
        maxDelay,
        limitPerHour,
        windowStart,
        windowEnd,
        noDuplicate,
      },
      recipients: rows,
      profileId: profile.id,
      enableAutomation,
      automationId: enableAutomation ? selectedAutomationId || null : null,
    });
    onClose();
  };

  const availableVars = nameCol ? ['nome', ...rawHeaders.filter(h => h !== phoneCol && h !== nameCol)] : rawHeaders.filter(h => h !== phoneCol);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Nova Campanha — Passo {step} de 3
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === 1 && (
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
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={handleFileComplete}
                  />
                </label>
              </div>
            </div>

            {rawHeaders.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Coluna de Telefone *</Label>
                    <Select value={phoneCol} onValueChange={setPhoneCol}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {rawHeaders.map(h => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Coluna de Nome (opcional)</Label>
                    <Select value={nameCol} onValueChange={setNameCol}>
                      <SelectTrigger>
                        <SelectValue placeholder="Nenhuma" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Nenhuma</SelectItem>
                        {rawHeaders.map(h => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Preview */}
                <div>
                  <Label className="mb-2 block">Preview (primeiras 20 linhas)</Label>
                  <div className="border rounded-md overflow-auto max-h-[200px]">
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

            <div className="flex justify-end">
              <Button onClick={goToStep2} disabled={!phoneCol || allRawData.length === 0}>
                Próximo <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Message & Instance */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <Label>Nome da campanha *</Label>
              <Input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="Ex: Black Friday 2026" />
            </div>

            <div>
              <Label>Instância Evolution *</Label>
              <Select value={instanceName} onValueChange={setInstanceName}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
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
              <Select value={payloadType} onValueChange={(v) => setPayloadType(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Texto</SelectItem>
                  <SelectItem value="image">Imagem</SelectItem>
                  <SelectItem value="audio">Áudio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {payloadType === 'text' && (
              <div>
                <Label>Mensagem</Label>
                <Textarea
                  id="broadcast-message-textarea"
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  rows={5}
                  placeholder="Olá {{nome}}, tudo bem?"
                  onDrop={(e) => {
                    e.preventDefault();
                    const variable = e.dataTransfer.getData('text/plain');
                    if (!variable) return;
                    const textarea = e.currentTarget;
                    const start = textarea.selectionStart ?? messageText.length;
                    const newText = messageText.slice(0, start) + variable + messageText.slice(start);
                    setMessageText(newText);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                />
                {availableVars.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <span className="text-xs text-muted-foreground mr-1">Variáveis:</span>
                    {availableVars.map(v => (
                      <span
                        key={v}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', `{{${v}}}`);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => {
                          const textarea = document.getElementById('broadcast-message-textarea') as HTMLTextAreaElement | null;
                          const pos = textarea?.selectionStart ?? messageText.length;
                          const newText = messageText.slice(0, pos) + `{{${v}}}` + messageText.slice(pos);
                          setMessageText(newText);
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

            {/* Automation section */}
            <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="flex items-center gap-3">
                <Switch checked={enableAutomation} onCheckedChange={setEnableAutomation} />
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <Label className="font-medium">Iniciar automação após envio</Label>
                </div>
              </div>

              {enableAutomation && (
                <div>
                  <Label className="text-sm">Selecionar automação</Label>
                  <Select value={selectedAutomationId} onValueChange={setSelectedAutomationId}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Selecione uma automação..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(automations || []).map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    A automação será disparada para cada destinatário após o envio da mensagem. Use o gatilho "Disparo de Campanha" na automação.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
              </Button>
              <Button
                onClick={goToStep3}
                disabled={!campaignName || !instanceName || (payloadType === 'text' && !messageText) || ((payloadType === 'image' || payloadType === 'audio') && !mediaUrl)}
              >
                Próximo <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Campanha</span>
                  <span className="text-sm font-medium">{campaignName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Instância</span>
                  <span className="text-sm font-medium">{instanceName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Tipo</span>
                  <Badge variant="secondary">{payloadType === 'text' ? 'Texto' : payloadType === 'image' ? 'Imagem' : 'Áudio'}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Total válidos</span>
                  <span className="text-sm font-medium text-green-600">{rows.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Inválidos removidos</span>
                  <span className="text-sm font-medium text-destructive">{discarded}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Duplicatas removidas</span>
                  <span className="text-sm font-medium text-yellow-600">{duplicates}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Delay</span>
                  <span className="text-sm">{minDelay}s – {maxDelay}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Limite/hora</span>
                  <span className="text-sm">{limitPerHour}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Janela</span>
                  <span className="text-sm">{windowStart} – {windowEnd}</span>
                </div>
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

            {payloadType === 'text' && (
              <Card>
                <CardContent className="p-4">
                  <Label className="text-xs text-muted-foreground">Preview da mensagem</Label>
                  <p className="text-sm mt-1 whitespace-pre-wrap bg-muted/50 rounded-lg p-3">
                    {messageText}
                  </p>
                </CardContent>
              </Card>
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
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Criar e iniciar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
