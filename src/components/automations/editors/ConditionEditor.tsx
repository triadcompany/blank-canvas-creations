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

interface ConditionEditorProps {
  config: any;
  onChange: (config: any) => void;
}

const conditionTypes = [
  { value: "responded", label: "Respondeu mensagem" },
  { value: "not_responded", label: "Não respondeu" },
  { value: "clicked_button", label: "Clicou em botão" },
  { value: "has_tag", label: "Possui tag" },
  { value: "in_stage", label: "Está na etapa" },
  { value: "has_email", label: "Tem e-mail" },
];

export function ConditionEditor({ config, onChange }: ConditionEditorProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="font-poppins text-sm font-medium">Tipo de condição</Label>
        <Select
          value={config.conditionType || ""}
          onValueChange={(v) => onChange({ ...config, conditionType: v })}
        >
          <SelectTrigger className="mt-1.5">
            <SelectValue placeholder="Selecione a condição" />
          </SelectTrigger>
          <SelectContent>
            {conditionTypes.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(config.conditionType === "responded" || config.conditionType === "not_responded") && (
        <div>
          <Label className="font-poppins text-sm">Janela de tempo (horas)</Label>
          <Input
            type="number"
            min={1}
            className="mt-1.5"
            placeholder="24"
            value={config.windowTime || ""}
            onChange={(e) =>
              onChange({ ...config, windowTime: parseInt(e.target.value) || 0 })
            }
          />
          <p className="text-xs text-muted-foreground mt-1 font-poppins">
            Tempo máximo para considerar a resposta (0 = sem limite)
          </p>
        </div>
      )}

      {config.conditionType === "has_tag" && (
        <div>
          <Label className="font-poppins text-sm">Tag</Label>
          <Input
            className="mt-1.5"
            placeholder="Nome da tag"
            value={config.value || ""}
            onChange={(e) => onChange({ ...config, value: e.target.value })}
          />
        </div>
      )}

      {config.conditionType === "in_stage" && (
        <div className="space-y-3">
          <div>
            <Label className="font-poppins text-sm">Pipeline</Label>
            <Input
              className="mt-1.5"
              placeholder="Nome do pipeline"
              value={config.pipeline || ""}
              onChange={(e) => onChange({ ...config, pipeline: e.target.value })}
            />
          </div>
          <div>
            <Label className="font-poppins text-sm">Etapa</Label>
            <Input
              className="mt-1.5"
              placeholder="Nome da etapa"
              value={config.value || ""}
              onChange={(e) => onChange({ ...config, value: e.target.value })}
            />
          </div>
        </div>
      )}

      {config.conditionType === "clicked_button" && (
        <div>
          <Label className="font-poppins text-sm">Payload do botão</Label>
          <Input
            className="mt-1.5"
            placeholder="Ex: sim, nao"
            value={config.value || ""}
            onChange={(e) => onChange({ ...config, value: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
