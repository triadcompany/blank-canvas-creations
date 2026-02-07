import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PhoneInput } from "@/components/ui/phone-input";
import { Lead } from "@/hooks/useSupabaseLeads";
import { useSupabaseProfiles } from "@/hooks/useSupabaseProfiles";
import { useAuth } from "@/contexts/AuthContext";
import { useLeadSources } from "@/hooks/useLeadSources";
import { BRAZILIAN_STATES } from "@/lib/brazilian-states";

interface AddLeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (newLead: Omit<Lead, 'id' | 'created_at' | 'created_by' | 'stage_id'>) => void;
}

// Função para formatar valor em moeda brasileira
const formatCurrency = (value: string) => {
  const numbers = value.replace(/\D/g, '');
  const amount = parseInt(numbers || '0', 10) / 100;
  return amount.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
};

// Função para converter string formatada em número
const parseCurrency = (value: string): number => {
  const numbers = value.replace(/\D/g, '');
  return parseInt(numbers || '0', 10) / 100;
};

export function AddLeadModal({ open, onOpenChange, onSave }: AddLeadModalProps) {
  const { user, role } = useAuth();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    seller_id: "",
    source: "",
    interest: "",
    price: "",
    observations: "",
    // Novos campos
    valor_negocio: "",
    servico: "",
    cidade: "",
    estado: ""
  });
  
  const { profiles } = useSupabaseProfiles();
  const { leadSources } = useLeadSources();

  // Filtrar perfis baseado no role do usuário
  const availableProfiles = useMemo(() => {
    // Se for vendedor (seller), só mostra o próprio usuário
    if (role === 'seller' && user) {
      return profiles.filter(p => p.id === user.id);
    }
    // Se for admin, mostra todos
    return profiles;
  }, [profiles, role, user]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validação dos campos obrigatórios
    if (!formData.name.trim()) {
      alert("Nome é obrigatório");
      return;
    }
    if (!formData.phone.trim()) {
      alert("Telefone é obrigatório");
      return;
    }
    if (!formData.seller_id.trim()) {
      alert("Vendedor responsável é obrigatório");
      return;
    }

    // Preparar dados para salvar
    const dataToSave = {
      ...formData,
      valor_negocio: formData.valor_negocio ? parseCurrency(formData.valor_negocio) : undefined,
    };

    onSave(dataToSave as any);
    setFormData({
      name: "",
      email: "",
      phone: "",
      seller_id: "",
      source: "",
      interest: "",
      price: "",
      observations: "",
      valor_negocio: "",
      servico: "",
      cidade: "",
      estado: ""
    });
    onOpenChange(false);
  };

  const handleInputChange = (field: string, value: string) => {
    if (field === 'valor_negocio') {
      setFormData(prev => ({ ...prev, [field]: formatCurrency(value) }));
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto card-gradient">
        <DialogHeader>
          <DialogTitle className="font-poppins font-bold text-xl text-foreground">
            Cadastrar Novo Lead
          </DialogTitle>
          <DialogDescription className="font-poppins text-muted-foreground">
            Preencha as informações do cliente para adicionar ao funil de vendas
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Seção: Informações Básicas */}
          <div className="space-y-4">
            <h3 className="font-poppins font-semibold text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary"></div>
              Informações Básicas
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Nome */}
              <div className="space-y-2">
                <Label htmlFor="name" className="font-poppins font-medium">
                  Nome Completo *
                </Label>
                <Input 
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  placeholder="Ex: João Silva"
                  className="font-poppins"
                  required
                />
              </div>

              {/* Telefone */}
              <div className="space-y-2">
                <Label htmlFor="phone" className="font-poppins font-medium">
                  Telefone/WhatsApp *
                </Label>
                <PhoneInput
                  id="phone"
                  value={formData.phone}
                  onChange={(value) => handleInputChange("phone", value)}
                  placeholder="11999999999"
                  required
                />
              </div>

              {/* E-mail */}
              <div className="space-y-2">
                <Label htmlFor="email" className="font-poppins font-medium">
                  E-mail
                </Label>
                <Input 
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  placeholder="joao@email.com"
                  className="font-poppins"
                />
              </div>

              {/* Vendedor Responsável */}
              <div className="space-y-2">
                <Label htmlFor="seller" className="font-poppins font-medium">
                  Vendedor Responsável *
                </Label>
                <Select value={formData.seller_id} onValueChange={(value) => handleInputChange("seller_id", value)}>
                  <SelectTrigger className="font-poppins">
                    <SelectValue placeholder="Selecione o vendedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableProfiles.map(profile => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Origem */}
              <div className="space-y-2">
                <Label htmlFor="source" className="font-poppins font-medium">
                  Origem
                </Label>
                <Select value={formData.source} onValueChange={(value) => handleInputChange("source", value)}>
                  <SelectTrigger className="font-poppins">
                    <SelectValue placeholder="Selecione a origem" />
                  </SelectTrigger>
                  <SelectContent>
                    {leadSources.length > 0 ? (
                      leadSources.map(source => (
                        <SelectItem key={source.id} value={source.name}>
                          {source.name}
                        </SelectItem>
                      ))
                    ) : (
                      <>
                        <SelectItem value="Facebook Ads">Facebook Ads</SelectItem>
                        <SelectItem value="Instagram">Instagram</SelectItem>
                        <SelectItem value="Google">Google</SelectItem>
                        <SelectItem value="Indicação">Indicação</SelectItem>
                        <SelectItem value="Orgânico">Orgânico</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Interesse */}
              <div className="space-y-2">
                <Label htmlFor="interest" className="font-poppins font-medium">
                  Interesse / Detalhes
                </Label>
                <Input 
                  id="interest"
                  value={formData.interest}
                  onChange={(e) => handleInputChange("interest", e.target.value)}
                  placeholder="Descreva o interesse do lead"
                  className="font-poppins"
                />
              </div>
            </div>
          </div>

          {/* Seção: Dados Financeiros */}
          <div className="space-y-4">
            <h3 className="font-poppins font-semibold text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500"></div>
              Dados Financeiros
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Valor do Negócio */}
              <div className="space-y-2">
                <Label htmlFor="valor-negocio" className="font-poppins font-medium">
                  Valor do Negócio
                </Label>
                <Input 
                  id="valor-negocio"
                  value={formData.valor_negocio}
                  onChange={(e) => handleInputChange("valor_negocio", e.target.value)}
                  placeholder="R$ 0,00"
                  className="font-poppins"
                />
                <p className="text-xs text-muted-foreground">
                  Valor estimado da venda
                </p>
              </div>

              {/* Serviço/Produto */}
              <div className="space-y-2">
                <Label htmlFor="servico" className="font-poppins font-medium">
                  Serviço / Produto
                </Label>
                <Input 
                  id="servico"
                  value={formData.servico}
                  onChange={(e) => handleInputChange("servico", e.target.value)}
                  placeholder="Ex: Consultoria, Veículo, Serviço..."
                  className="font-poppins"
                />
              </div>
            </div>
          </div>

          {/* Seção: Localização */}
          <div className="space-y-4">
            <h3 className="font-poppins font-semibold text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              Localização
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Cidade */}
              <div className="space-y-2">
                <Label htmlFor="cidade" className="font-poppins font-medium">
                  Cidade
                </Label>
                <Input 
                  id="cidade"
                  value={formData.cidade}
                  onChange={(e) => handleInputChange("cidade", e.target.value)}
                  placeholder="Ex: São Paulo"
                  className="font-poppins"
                />
              </div>

              {/* Estado */}
              <div className="space-y-2">
                <Label htmlFor="estado" className="font-poppins font-medium">
                  Estado
                </Label>
                <Select value={formData.estado} onValueChange={(value) => handleInputChange("estado", value)}>
                  <SelectTrigger className="font-poppins">
                    <SelectValue placeholder="Selecione o estado" />
                  </SelectTrigger>
                  <SelectContent>
                    {BRAZILIAN_STATES.map(state => (
                      <SelectItem key={state.value} value={state.value}>
                        {state.value} - {state.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Observações */}
          <div className="space-y-2">
            <Label htmlFor="observations" className="font-poppins font-medium">
              Observações
            </Label>
            <Textarea 
              id="observations"
              value={formData.observations}
              onChange={(e) => handleInputChange("observations", e.target.value)}
              placeholder="Informações adicionais sobre o lead..."
              className="font-poppins min-h-[80px]"
            />
          </div>

          {/* Botões */}
          <div className="flex justify-end space-x-3 pt-4">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              className="font-poppins font-medium"
            >
              Cancelar
            </Button>
            <Button 
              type="submit"
              className="btn-gradient text-white font-poppins font-medium"
            >
              Cadastrar Lead
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}