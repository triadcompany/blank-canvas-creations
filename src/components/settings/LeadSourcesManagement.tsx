import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { 
  Plus, 
  Trash2, 
  MapPin,
  Edit,
  Target,
  Shield
} from "lucide-react";

interface LeadSource {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export function LeadSourcesManagement() {
  const { profile, isAdmin } = useAuth();
  const { toast } = useToast();
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceDescription, setNewSourceDescription] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchLeadSources();
  }, []);

  const fetchLeadSources = async () => {
    try {
      const { data, error } = await supabase
        .from('lead_sources')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setLeadSources(data || []);
    } catch (error) {
      console.error('Erro ao buscar origens de leads:', error);
      toast({
        title: "Erro",
        description: "Erro ao carregar origens de leads",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createLeadSource = async () => {
    if (!newSourceName.trim()) {
      toast({
        title: "Erro",
        description: "Nome da origem é obrigatório",
        variant: "destructive",
      });
      return;
    }

    if (!profile?.organization_id) {
      toast({
        title: "Erro",
        description: "Organização não encontrada",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);

    try {
      const { error } = await supabase
        .from('lead_sources')
        .insert({
          name: newSourceName.trim(),
          description: newSourceDescription.trim() || null,
          organization_id: profile.organization_id,
          created_by: profile.id,
        });

      if (error) {
        if (error.code === '23505') {
          toast({
            title: "Erro",
            description: "Já existe uma origem com este nome",
            variant: "destructive",
          });
          return;
        }
        throw error;
      }

      toast({
        title: "Sucesso",
        description: "Origem de lead criada com sucesso",
      });

      setNewSourceName("");
      setNewSourceDescription("");
      setDialogOpen(false);
      fetchLeadSources();
    } catch (error) {
      console.error('Erro ao criar origem de lead:', error);
      toast({
        title: "Erro",
        description: "Erro ao criar origem de lead",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const deleteLeadSource = async (sourceId: string, sourceName: string) => {
    try {
      const { error } = await supabase
        .from('lead_sources')
        .update({ is_active: false })
        .eq('id', sourceId);

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: `Origem "${sourceName}" removida com sucesso`,
      });

      fetchLeadSources();
    } catch (error) {
      console.error('Erro ao remover origem de lead:', error);
      toast({
        title: "Erro",
        description: "Erro ao remover origem de lead",
        variant: "destructive",
      });
    }
  };

  if (!isAdmin) {
    return (
      <Card className="card-gradient border-0">
        <CardContent className="p-8 text-center">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-poppins font-bold text-foreground mb-2">
            Acesso Restrito
          </h2>
          <p className="text-muted-foreground font-poppins">
            Apenas administradores podem gerenciar origens de leads.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-poppins font-semibold text-foreground">
            Origens de Leads
          </h3>
          <p className="text-sm text-muted-foreground font-poppins">
            Gerencie as origens dos seus leads (ex: Site, WhatsApp, Indicação, etc.)
          </p>
        </div>
        
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="btn-gradient text-white font-poppins">
              <Plus className="h-4 w-4 mr-2" />
              Nova Origem
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-poppins">Criar Nova Origem</DialogTitle>
              <DialogDescription className="font-poppins">
                Adicione uma nova origem para classificar seus leads.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="sourceName" className="font-poppins">Nome da Origem</Label>
                <Input
                  id="sourceName"
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  placeholder="Ex: Site, WhatsApp, Indicação"
                  className="font-poppins"
                />
              </div>
              <div>
                <Label htmlFor="sourceDescription" className="font-poppins">Descrição (opcional)</Label>
                <Textarea
                  id="sourceDescription"
                  value={newSourceDescription}
                  onChange={(e) => setNewSourceDescription(e.target.value)}
                  placeholder="Descrição adicional sobre esta origem"
                  className="font-poppins"
                  rows={3}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)} className="font-poppins">
                  Cancelar
                </Button>
                <Button 
                  onClick={createLeadSource}
                  className="btn-gradient text-white font-poppins"
                  disabled={creating}
                >
                  {creating ? 'Criando...' : 'Criar Origem'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {loading ? (
          <div className="text-center py-8">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="mt-2 font-poppins text-muted-foreground text-sm">Carregando origens...</p>
          </div>
        ) : leadSources.length === 0 ? (
          <Card className="card-gradient border-0">
            <CardContent className="p-8 text-center">
              <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h4 className="text-lg font-poppins font-semibold mb-2">
                Nenhuma origem cadastrada
              </h4>
              <p className="text-muted-foreground font-poppins mb-4">
                Crie origens para classificar e organizar melhor seus leads.
              </p>
            </CardContent>
          </Card>
        ) : (
          leadSources.map((source) => (
            <Card key={source.id} className="card-gradient border-0">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                      <MapPin className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-poppins font-semibold text-foreground">
                        {source.name}
                      </h4>
                      {source.description && (
                        <p className="text-sm text-muted-foreground font-poppins">
                          {source.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="secondary" className="font-poppins">
                      Ativo
                    </Badge>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="font-poppins text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle className="font-poppins">
                            Remover origem de lead
                          </AlertDialogTitle>
                          <AlertDialogDescription className="font-poppins">
                            Tem certeza que deseja remover a origem "{source.name}"? 
                            Esta ação não pode ser desfeita.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="font-poppins">Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteLeadSource(source.id, source.name)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-poppins"
                          >
                            Remover
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}