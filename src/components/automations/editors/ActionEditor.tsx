import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ActionEditorProps {
  config: any;
  onChange: (config: any) => void;
}

const actionTypes = [
  { value: "add_tag", label: "Adicionar tag" },
  { value: "move_stage", label: "Mover etapa" },
  { value: "assign_owner", label: "Atribuir responsável" },
  { value: "send_whatsapp", label: "Enviar WhatsApp" },
  { value: "send_email", label: "Enviar e-mail" },
  { value: "update_lead", label: "Atualizar lead" },
  { value: "create_deal", label: "Criar negócio" },
  { value: "end_automation", label: "Encerrar automação" },
];

export function ActionEditor({ config, onChange }: ActionEditorProps) {
  const params = config.params || {};

  const updateParams = (key: string, value: string) => {
    onChange({ ...config, params: { ...params, [key]: value } });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="font-poppins text-sm font-medium">Tipo de ação</Label>
        <Select
          value={config.actionType || ""}
          onValueChange={(v) => onChange({ ...config, actionType: v, params: {} })}
        >
          <SelectTrigger className="mt-1.5">
            <SelectValue placeholder="Selecione a ação" />
          </SelectTrigger>
          <SelectContent>
            {actionTypes.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {config.actionType === "add_tag" && (
        <div>
          <Label className="font-poppins text-sm">Tag</Label>
          <Input
            className="mt-1.5"
            placeholder="Nome da tag"
            value={params.tag || ""}
            onChange={(e) => updateParams("tag", e.target.value)}
          />
        </div>
      )}

      {config.actionType === "move_stage" && (
        <div className="space-y-3">
          <div>
            <Label className="font-poppins text-sm">Pipeline</Label>
            <Input
              className="mt-1.5"
              placeholder="Nome do pipeline"
              value={params.pipeline || ""}
              onChange={(e) => updateParams("pipeline", e.target.value)}
            />
          </div>
          <div>
            <Label className="font-poppins text-sm">Etapa de destino</Label>
            <Input
              className="mt-1.5"
              placeholder="Nome da etapa"
              value={params.stage || ""}
              onChange={(e) => updateParams("stage", e.target.value)}
            />
          </div>
        </div>
      )}

      {config.actionType === "assign_owner" && (
        <div>
          <Label className="font-poppins text-sm">Responsável</Label>
          <Input
            className="mt-1.5"
            placeholder="Nome ou e-mail do responsável"
            value={params.owner || ""}
            onChange={(e) => updateParams("owner", e.target.value)}
          />
        </div>
      )}

      {config.actionType === "send_whatsapp" && (
        <div>
          <Label className="font-poppins text-sm">Mensagem</Label>
          <Input
            className="mt-1.5"
            placeholder="Texto da mensagem"
            value={params.message || ""}
            onChange={(e) => updateParams("message", e.target.value)}
          />
        </div>
      )}

      {config.actionType === "send_email" && (
        <div className="space-y-3">
          <div>
            <Label className="font-poppins text-sm">Assunto</Label>
            <Input
              className="mt-1.5"
              placeholder="Assunto do e-mail"
              value={params.subject || ""}
              onChange={(e) => updateParams("subject", e.target.value)}
            />
          </div>
          <div>
            <Label className="font-poppins text-sm">Corpo</Label>
            <Input
              className="mt-1.5"
              placeholder="Texto do e-mail"
              value={params.body || ""}
              onChange={(e) => updateParams("body", e.target.value)}
            />
          </div>
        </div>
      )}

      {config.actionType === "end_automation" && (
        <p className="text-sm text-muted-foreground font-poppins">
          Este bloco encerra a execução da automação para o lead atual.
        </p>
      )}
    </div>
  );
}
