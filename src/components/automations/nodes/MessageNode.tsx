import React, { memo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { MessageSquare } from "lucide-react";

export const MessageNode = memo(({ data, selected }: NodeProps) => {
  const config = (data as any).config || {};
  const preview = config.text ? config.text.substring(0, 60) + (config.text.length > 60 ? "..." : "") : "Configurar mensagem";

  return (
    <div
      className={`px-4 py-3 rounded-xl border-2 shadow-md bg-card min-w-[200px] ${
        selected ? "border-blue-500 shadow-blue-500/20" : "border-blue-500/30"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-blue-500 !w-3 !h-3 !border-2 !border-background"
      />
      <div className="flex items-center gap-2 mb-1">
        <div className="p-1 rounded-md bg-blue-500/10">
          <MessageSquare className="h-4 w-4 text-blue-500" />
        </div>
        <span className="text-xs font-poppins font-bold text-blue-500 uppercase">Mensagem</span>
      </div>
      <p className="text-sm font-poppins text-foreground">{preview}</p>
      {config.buttons?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {config.buttons.map((btn: string, i: number) => (
            <span key={i} className="text-xs bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded-full font-poppins">
              {btn}
            </span>
          ))}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-blue-500 !w-3 !h-3 !border-2 !border-background"
      />
    </div>
  );
});

MessageNode.displayName = "MessageNode";
