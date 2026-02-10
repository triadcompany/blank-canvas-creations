import { useState } from "react";
import { CRMLayout } from "@/components/layout/CRMLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Zap,
  Play,
  Pause,
  Copy,
  Trash2,
  ArrowLeft,
  FileText,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { useAutomations, Automation } from "@/hooks/useAutomations";
import { useAuth } from "@/contexts/AuthContext";
import { AutomationFlowEditor } from "@/components/automations/AutomationFlowEditor";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function Automacoes() {
  const { automations, loading, createAutomation, updateAutomation, deleteAutomation, duplicateAutomation, toggleActive } = useAutomations();
  const { isAdmin } = useAuth();
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [createDialog, setCreateDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const result = await createAutomation(newName, newDesc);
    if (result) {
      setCreateDialog(false);
      setNewName("");
      setNewDesc("");
      setEditingAutomation(result);
    }
  };

  const handleSaveFlow = async (flow: any) => {
    if (!editingAutomation) return;
    await updateAutomation(editingAutomation.id, { flow_definition: flow } as any);
    setEditingAutomation({ ...editingAutomation, flow_definition: flow });
  };

  const handleToggle = async () => {
    if (!editingAutomation) return;
    const success = await toggleActive(editingAutomation.id, editingAutomation.is_active);
    if (success) {
      setEditingAutomation({ ...editingAutomation, is_active: !editingAutomation.is_active });
    }
  };

  // Flow editor view
  if (editingAutomation) {
    return (
      <CRMLayout>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setEditingAutomation(null)}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Voltar
            </Button>
            <div className="flex-1">
              <h2 className="text-lg font-poppins font-bold text-foreground">{editingAutomation.name}</h2>
              {editingAutomation.description && (
                <p className="text-sm text-muted-foreground font-poppins">{editingAutomation.description}</p>
              )}
            </div>
            <Badge variant={editingAutomation.is_active ? "default" : "secondary"}>
              {editingAutomation.is_active ? "Ativo" : "Inativo"}
            </Badge>
            <Badge variant="outline" className="font-poppins">
              <MessageSquare className="h-3 w-3 mr-1" />
              WhatsApp
            </Badge>
          </div>
          <AutomationFlowEditor
            flowDefinition={editingAutomation.flow_definition}
            onSave={handleSaveFlow}
            isActive={editingAutomation.is_active}
            onToggleActive={handleToggle}
          />
        </div>
      </CRMLayout>
    );
  }

  // List view
  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <PageHeader
            title="Automações"
            description="Crie fluxos automáticos de mensagens e ações para seus leads"
          />
          {isAdmin && (
            <Button className="btn-gradient text-white font-poppins gap-2" onClick={() => setCreateDialog(true)}>
              <Plus className="h-4 w-4" />
              Nova Automação
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : automations.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Zap className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-poppins font-semibold mb-2">Nenhuma automação criada</h3>
              <p className="text-muted-foreground font-poppins text-sm mb-6 text-center max-w-md">
                Crie fluxos automáticos para enviar mensagens, mover leads no pipeline e muito mais.
              </p>
              {isAdmin && (
                <Button className="btn-gradient text-white font-poppins gap-2" onClick={() => setCreateDialog(true)}>
                  <Plus className="h-4 w-4" />
                  Criar primeira automação
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {automations.map((automation) => (
              <Card
                key={automation.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setEditingAutomation(automation)}
              >
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className={`p-2.5 rounded-xl ${automation.is_active ? "bg-primary/10" : "bg-muted"}`}>
                        <Zap className={`h-5 w-5 ${automation.is_active ? "text-primary" : "text-muted-foreground"}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-poppins font-semibold text-foreground truncate">{automation.name}</h3>
                          <Badge variant={automation.is_active ? "default" : "secondary"} className="text-xs">
                            {automation.is_active ? "Ativo" : "Inativo"}
                          </Badge>
                        </div>
                        {automation.description && (
                          <p className="text-sm text-muted-foreground font-poppins truncate">{automation.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground font-poppins mt-1">
                          Criada em {format(new Date(automation.created_at), "dd/MM/yyyy", { locale: ptBR })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleActive(automation.id, automation.is_active)}
                        title={automation.is_active ? "Desativar" : "Ativar"}
                      >
                        {automation.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => duplicateAutomation(automation)}
                        title="Duplicar"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteAutomation(automation.id)}
                          className="text-destructive hover:text-destructive"
                          title="Excluir"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create Dialog */}
        <Dialog open={createDialog} onOpenChange={setCreateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-poppins">Nova Automação</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="font-poppins">Nome</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Boas-vindas novo lead"
                  className="font-poppins"
                />
              </div>
              <div>
                <Label className="font-poppins">Descrição (opcional)</Label>
                <Textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Descreva o objetivo desta automação"
                  className="font-poppins"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialog(false)} className="font-poppins">
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={!newName.trim()} className="btn-gradient text-white font-poppins">
                Criar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </CRMLayout>
  );
}
