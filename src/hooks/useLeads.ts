import { useState } from "react";

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  seller: string;
  source: string;
  interest: string;
  observations: string;
  createdAt: string;
  stage: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  leads: Lead[];
  color: string;
  count: number;
}

const initialLeads: Lead[] = [
  {
    id: "1",
    name: "Carlos Silva",
    email: "carlos@email.com",
    phone: "(11) 99999-9999",
    seller: "João Vendedor",
    source: "Facebook Ads",
    interest: "Civic 2024",
    observations: "Interessado em financiamento",
    createdAt: "2024-01-15",
    stage: "novo"
  },
  {
    id: "2", 
    name: "Maria Oliveira",
    email: "maria@email.com",
    phone: "(11) 88888-8888",
    seller: "Ana Santos",
    source: "Google",
    interest: "Corolla 2024",
    observations: "Primeira compra",
    createdAt: "2024-01-14",
    stage: "novo"
  },
  {
    id: "3",
    name: "Pedro Costa",
    email: "pedro@email.com", 
    phone: "(11) 77777-7777",
    seller: "Carlos Vendedor",
    source: "Indicação",
    interest: "HRV 2024",
    observations: "Orçamento aprovado",
    createdAt: "2024-01-13",
    stage: "qualificado"
  }
];

const columns: Omit<KanbanColumn, 'leads' | 'count'>[] = [
  {
    id: "novo",
    title: "Novo Lead",
    color: "bg-blue-500"
  },
  {
    id: "nao-qualificado",
    title: "Não Qualificado",
    color: "bg-gray-500"
  },
  {
    id: "qualificado",
    title: "Qualificado",
    color: "bg-primary"
  },
  {
    id: "em-andamento",
    title: "Em Andamento",
    color: "bg-yellow-500"
  },
  {
    id: "agendamento",
    title: "Agendamento",
    color: "bg-purple-500"
  },
  {
    id: "follow-up",
    title: "Follow Up",
    color: "bg-indigo-500"
  },
  {
    id: "fechado",
    title: "Fechado",
    color: "bg-emerald-500"
  },
  {
    id: "perdido",
    title: "Perdido",
    color: "bg-red-500"
  }
];

export function useLeads() {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);

  const getKanbanColumns = (): KanbanColumn[] => {
    return columns.map(column => {
      const columnLeads = leads.filter(lead => lead.stage === column.id);
      return {
        ...column,
        leads: columnLeads,
        count: columnLeads.length
      };
    });
  };

  const moveLead = (leadId: string, newStage: string) => {
    setLeads(prevLeads => 
      prevLeads.map(lead => 
        lead.id === leadId 
          ? { ...lead, stage: newStage }
          : lead
      )
    );
  };

  const updateLead = (leadId: string, updatedLead: Partial<Lead>) => {
    setLeads(prevLeads => 
      prevLeads.map(lead => 
        lead.id === leadId 
          ? { ...lead, ...updatedLead }
          : lead
      )
    );
  };

  const addLead = (newLead: Omit<Lead, 'id' | 'createdAt'>) => {
    const lead: Lead = {
      ...newLead,
      id: Date.now().toString(),
      createdAt: new Date().toISOString().split('T')[0],
      stage: 'novo'
    };
    setLeads(prevLeads => [lead, ...prevLeads]);
  };

  const getLead = (leadId: string): Lead | undefined => {
    return leads.find(lead => lead.id === leadId);
  };

  return {
    leads,
    kanbanColumns: getKanbanColumns(),
    moveLead,
    updateLead,
    addLead,
    getLead
  };
}