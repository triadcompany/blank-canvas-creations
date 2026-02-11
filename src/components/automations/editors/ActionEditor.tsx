import React, { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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

const priorityOptions = [
  { value: "0", label: "Sem prioridade" },
  { value: "1", label: "1 – Baixa" },
  { value: "2", label: "2 – Média" },
  { value: "3", label: "3 – Alta" },
  { value: "4", label: "4 – Urgente" },
];

interface Pipeline {
  id: string;
  name: string;
}

interface Stage {
  id: string;
  name: string;
  pipeline_id: string;
}

interface LeadSource {
  id: string;
  name: string;
}

export function ActionEditor({ config, onChange }: ActionEditorProps) {
  const params = config.params || {};
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);

  // Fetch pipelines, sources and members once
  useEffect(() => {
    if (!orgId) return;

    const fetchData = async () => {
      const [pRes, sRes, mRes] = await Promise.all([
        supabase.rpc("get_org_pipelines", { p_org_id: orgId }),
        supabase.from("lead_sources").select("id, name").eq("organization_id", orgId).eq("is_active", true).order("sort_order").order("name"),
        supabase.from("profiles").select("id, name").eq("organization_id", orgId).order("name"),
      ]);
      if (pRes.data) setPipelines(pRes.data as Pipeline[]);
      if (sRes.data) setSources(sRes.data as LeadSource[]);
      if (mRes.data) setMembers(mRes.data as { id: string; name: string }[]);
    };
    fetchData();
  }, [orgId]);

  // Fetch stages when pipeline changes
  useEffect(() => {
    if (!params.pipeline_id) {
      setStages([]);
      return;
    }
    const fetchStages = async () => {
      const { data } = await supabase.rpc("get_pipeline_stages", {
        p_pipeline_id: params.pipeline_id,
      });
      if (data) setStages(data as Stage[]);
    };
    fetchStages();
  }, [params.pipeline_id]);

  const updateParams = (key: string, value: string | boolean) => {
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

      {/* ── Criar negócio ── */}
      {config.actionType === "create_deal" && (
        <div className="space-y-4 border border-border rounded-lg p-3 bg-muted/30">
          <p className="text-[11px] text-muted-foreground font-poppins">
            Cria um lead/negócio no CRM com os dados abaixo.
          </p>

          {/* Origem */}
          <div>
            <Label className="font-poppins text-sm">Origem do lead</Label>
            <Select
              value={params.source || ""}
              onValueChange={(v) => updateParams("source", v)}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Selecione a origem" />
              </SelectTrigger>
              <SelectContent>
                {sources.length > 0 ? (
                  sources.map((s) => (
                    <SelectItem key={s.id} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="" disabled>
                    Nenhuma origem cadastrada
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Pipeline */}
          <div>
            <Label className="font-poppins text-sm">Pipeline</Label>
            <Select
              value={params.pipeline_id || ""}
              onValueChange={(v) => {
                onChange({
                  ...config,
                  params: { ...params, pipeline_id: v, stage_id: "" },
                });
              }}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Selecione o pipeline" />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Etapa */}
          <div>
            <Label className="font-poppins text-sm">Etapa</Label>
            <Select
              value={params.stage_id || ""}
              onValueChange={(v) => updateParams("stage_id", v)}
              disabled={!params.pipeline_id}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder={params.pipeline_id ? "Selecione a etapa" : "Selecione o pipeline primeiro"} />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Prioridade */}
          <div>
            <Label className="font-poppins text-sm">Prioridade</Label>
            <Select
              value={String(params.priority ?? "0")}
              onValueChange={(v) => updateParams("priority", v)}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {priorityOptions.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Responsável */}
          <div>
            <Label className="font-poppins text-sm">Responsável (se vazio, usa distribuição/fallback)</Label>
            <Select
              value={params.owner_id || "none"}
              onValueChange={(v) => updateParams("owner_id", v === "none" ? "" : v)}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Nenhum (distribuição automática)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum (distribuição automática)</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">
              Se não escolher um responsável, o sistema atribui automaticamente via distribuição ou fallback (admin/primeiro vendedor).
            </p>
          </div>

          {/* Deduplicação */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-poppins text-sm">Deduplicação</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Criar apenas se não existir negócio aberto para esse telefone
              </p>
            </div>
            <Switch
              checked={params.deduplicate ?? true}
              onCheckedChange={(v) => updateParams("deduplicate", v)}
            />
          </div>
        </div>
      )}

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
