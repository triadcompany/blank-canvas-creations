import React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

interface TriggerEditorProps {
  config: any;
  onChange: (config: any) => void;
}

const triggerTypes = [
  { value: "lead_created", label: "Lead criado" },
  { value: "lead_stage_changed", label: "Lead movido de etapa" },
  { value: "lead_from_instagram", label: "Lead via Instagram" },
  { value: "lead_from_whatsapp", label: "Lead via WhatsApp" },
  { value: "tag_added", label: "Tag adicionada" },
  { value: "form_submitted", label: "Formulário enviado" },
];

export function TriggerEditor({ config, onChange }: TriggerEditorProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="font-poppins text-sm font-medium">Tipo de gatilho</Label>
        <Select
          value={config.triggerType || ""}
          onValueChange={(v) => onChange({ ...config, triggerType: v })}
        >
          <SelectTrigger className="mt-1.5">
            <SelectValue placeholder="Selecione o gatilho" />
          </SelectTrigger>
          <SelectContent>
            {triggerTypes.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {config.triggerType === "lead_stage_changed" && (
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
              value={config.stage || ""}
              onChange={(e) => onChange({ ...config, stage: e.target.value })}
            />
          </div>
        </div>
      )}

      {config.triggerType === "tag_added" && (
        <div>
          <Label className="font-poppins text-sm">Tag</Label>
          <Input
            className="mt-1.5"
            placeholder="Nome da tag"
            value={config.tag || ""}
            onChange={(e) => onChange({ ...config, tag: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
