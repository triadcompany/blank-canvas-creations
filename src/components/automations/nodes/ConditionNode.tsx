import React, { memo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";

const conditionLabels: Record<string, string> = {
  responded: "Respondeu mensagem",
  not_responded: "Não respondeu",
  clicked_button: "Clicou em botão",
  in_stage: "Está na etapa",
};

export const ConditionNode = memo(({ data, selected }: NodeProps) => {
  const config = (data as any).config || {};
  const label = conditionLabels[config.conditionType] || "Configurar condição";

  return (
    <div
      className={`px-4 py-3 rounded-xl border-2 shadow-md bg-card min-w-[200px] ${
        selected ? "border-emerald-500 shadow-emerald-500/20" : "border-emerald-500/30"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-emerald-500 !w-3 !h-3 !border-2 !border-background"
      />
      <div className="flex items-center gap-2 mb-1">
        <div className="p-1 rounded-md bg-emerald-500/10">
          <GitBranch className="h-4 w-4 text-emerald-500" />
        </div>
        <span className="text-xs font-poppins font-bold text-emerald-500 uppercase">Condição</span>
      </div>
      <p className="text-sm font-poppins text-foreground">{label}</p>
      <div className="flex justify-between mt-2 text-[10px] font-poppins text-muted-foreground">
        <span>Sim ✓</span>
        <span>Não ✗</span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="yes"
        style={{ left: "30%" }}
        className="!bg-emerald-500 !w-3 !h-3 !border-2 !border-background"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        style={{ left: "70%" }}
        className="!bg-red-500 !w-3 !h-3 !border-2 !border-background"
      />
    </div>
  );
});

ConditionNode.displayName = "ConditionNode";
