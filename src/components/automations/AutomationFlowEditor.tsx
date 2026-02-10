import React, { useCallback, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  Node,
  Panel,
  MarkerType,
  ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Save, Play, Pause, AlertTriangle } from "lucide-react";
import { TriggerNode } from "./nodes/TriggerNode";
import { MessageNode } from "./nodes/MessageNode";
import { DelayNode } from "./nodes/DelayNode";
import { ConditionNode } from "./nodes/ConditionNode";
import { ActionNode } from "./nodes/ActionNode";
import { BlocksSidebar } from "./BlocksSidebar";
import { useToast } from "@/hooks/use-toast";

const nodeTypes = {
  trigger: TriggerNode,
  message: MessageNode,
  delay: DelayNode,
  condition: ConditionNode,
  action: ActionNode,
};

interface AutomationFlowEditorProps {
  flowDefinition: { nodes: Node[]; edges: Edge[] };
  onSave: (flow: { nodes: Node[]; edges: Edge[] }) => void;
  isActive: boolean;
  onToggleActive: () => void;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateFlow(nodes: Node[], edges: Edge[]): ValidationResult {
  const errors: string[] = [];

  // 1. Must have at least one trigger
  const triggers = nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) {
    errors.push("A automação precisa de pelo menos um Gatilho.");
  }

  // 2. Trigger must have an outgoing edge (initial node connected)
  for (const trigger of triggers) {
    const hasOutgoing = edges.some((e) => e.source === trigger.id);
    if (!hasOutgoing) {
      errors.push(`O gatilho "${(trigger.data as any).label || "Gatilho"}" não está conectado a nenhum nó.`);
    }
  }

  // 3. No loose nodes (every non-trigger node must have at least one incoming edge)
  const nonTriggerNodes = nodes.filter((n) => n.type !== "trigger");
  for (const node of nonTriggerNodes) {
    const hasIncoming = edges.some((e) => e.target === node.id);
    if (!hasIncoming) {
      const label = (node.data as any).label || node.type;
      errors.push(`O nó "${label}" está solto (sem conexão de entrada).`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function AutomationFlowEditor({
  flowDefinition,
  onSave,
  isActive,
  onToggleActive,
}: AutomationFlowEditorProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(flowDefinition.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowDefinition.edges || []);
  const { toast } = useToast();

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--primary))" },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow-type");
      const label = event.dataTransfer.getData("application/reactflow-label");
      if (!type || !reactFlowInstance) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: `${type}_${Date.now()}`,
        type,
        position,
        data: { label, config: getDefaultConfig(type) },
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const handleSave = () => {
    onSave({ nodes, edges });
  };

  const handleToggleActive = () => {
    if (!isActive) {
      // Validate before activating
      const result = validateFlow(nodes, edges);
      if (!result.valid) {
        toast({
          title: "Não é possível ativar",
          description: result.errors.join("\n"),
          variant: "destructive",
        });
        return;
      }
    }
    onToggleActive();
  };

  return (
    <div className="flex h-[calc(100vh-200px)] border border-border rounded-lg overflow-hidden">
      <BlocksSidebar />
      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode={["Backspace", "Delete"]}
          className="bg-background"
        >
          <Background color="hsl(var(--muted-foreground))" gap={20} size={1} />
          <Controls className="!bg-card !border-border !shadow-md" />
          <MiniMap
            className="!bg-card !border-border"
            nodeColor="hsl(var(--primary))"
            maskColor="hsl(var(--background) / 0.8)"
          />
          <Panel position="top-right" className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleSave} className="gap-2">
              <Save className="h-4 w-4" />
              Salvar
            </Button>
            <Button
              size="sm"
              variant={isActive ? "destructive" : "default"}
              onClick={handleToggleActive}
              className="gap-2"
            >
              {isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isActive ? "Desativar" : "Ativar"}
            </Button>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}

function getDefaultConfig(type: string) {
  switch (type) {
    case "trigger":
      return { triggerType: "lead_created" };
    case "message":
      return { text: "", variables: [], buttons: [] };
    case "delay":
      return { amount: 1, unit: "hours" };
    case "condition":
      return { conditionType: "responded", value: "" };
    case "action":
      return { actionType: "update_lead", params: {} };
    default:
      return {};
  }
}
