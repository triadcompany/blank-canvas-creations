import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBroadcasts } from '@/hooks/useBroadcasts';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Radio, Loader2, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { NewCampaignWizard } from '@/components/broadcasts/NewCampaignWizard';

const statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  running: { label: 'Em andamento', variant: 'default' },
  paused: { label: 'Pausada', variant: 'secondary' },
  completed: { label: 'Concluída', variant: 'outline' },
  canceled: { label: 'Cancelada', variant: 'destructive' },
};

const typeLabels: Record<string, string> = {
  text: 'Texto',
  image: 'Imagem',
  audio: 'Áudio',
};

export default function Broadcasts() {
  const { campaigns, loading } = useBroadcasts();
  const [showWizard, setShowWizard] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Disparos"
          description="Envie mensagens em massa via WhatsApp"
        />
        <Button onClick={() => setShowWizard(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Campanha
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Radio className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-medium text-foreground">Nenhuma campanha</h3>
              <p className="text-sm text-muted-foreground mt-1">Crie sua primeira campanha de disparos</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Instância</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead>Enviados/Total</TableHead>
                  <TableHead>Falhas</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => {
                  const st = statusLabels[c.status] || { label: c.status, variant: 'outline' as const };
                  return (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/broadcasts/${c.id}`)}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c.instance_name}</TableCell>
                      <TableCell>{typeLabels[c.payload_type] || c.payload_type}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(c.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                      </TableCell>
                      <TableCell>
                        <span className="text-green-600 font-medium">{c.sent}</span>
                        <span className="text-muted-foreground">/{c.total}</span>
                      </TableCell>
                      <TableCell>
                        {(c.failed || 0) > 0 ? (
                          <span className="text-destructive font-medium">{c.failed}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {showWizard && (
        <NewCampaignWizard onClose={() => setShowWizard(false)} />
      )}
    </div>
  );
}
