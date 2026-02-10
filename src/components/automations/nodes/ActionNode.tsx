import React, { memo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { Cog } from "lucide-react";

const actionLabels: Record<string, string> = {
  create_lead: "Criar lead",
  update_lead: "Atualizar lead",
  create_deal: "Criar negócio",
  move_stage: "Mover etapa",
  assign_owner: "Atribuir responsável",
  add_tag: "Adicionar tag",
  end_automation: "Encerrar automação",
};

export const ActionNode = memo(({ data, selected }: NodeProps) => {
  const config = (data as any).config || {};
  const label = actionLabels[config.actionType] || "Configurar ação";

  return (
    <div
      className={`px-4 py-3 rounded-xl border-2 shadow-md bg-card min-w-[180px] ${
        selected ? "border-orange-500 shadow-orange-500/20" : "border-orange-500/30"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-orange-500 !w-3 !h-3 !border-2 !border-background"
      />
      <div className="flex items-center gap-2 mb-1">
        <div className="p-1 rounded-md bg-orange-500/10">
          <Cog className="h-4 w-4 text-orange-500" />
        </div>
        <span className="text-xs font-poppins font-bold text-orange-500 uppercase">Ação</span>
      </div>
      <p className="text-sm font-poppins text-foreground">{label}</p>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-orange-500 !w-3 !h-3 !border-2 !border-background"
      />
    </div>
  );
});

ActionNode.displayName = "ActionNode";
