'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  createAutomationRule,
  deleteAutomationRule,
  toggleAutomationRule,
  updateAutomationRule,
  type AutomationAction,
  type AutomationRule,
  type AutomationTrigger,
} from '@/actions/automations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface StageOption {
  slug: string;
  name: string;
}

interface UserOption {
  id: string;
  name: string;
}

interface AutomationsManagerProps {
  rules: AutomationRule[];
  stages: StageOption[];
  users: UserOption[];
}

const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  lead_criado: 'Quando um lead novo entrar',
  entrou_etapa: 'Quando o lead entrar em uma etapa',
  parado_na_etapa: 'Quando o lead ficar parado em uma etapa',
  visita_amanha: 'Quando houver visita marcada para amanhã',
  sem_resposta: 'Quando a família ficar sem resposta no chat',
};

const ACTION_LABELS: Record<AutomationAction, string> = {
  notificar: 'Notificar a equipe',
  criar_tarefa: 'Criar uma tarefa',
  enviar_whatsapp: 'Enviar WhatsApp (em breve)',
};

/** Unidades de tempo do formulário → minutos (formato salvo no banco). */
const TIME_UNITS = [
  { value: 'minutos', label: 'minutos', factor: 1 },
  { value: 'horas', label: 'horas', factor: 60 },
  { value: 'dias', label: 'dias', factor: 1440 },
] as const;

type TimeUnit = (typeof TIME_UNITS)[number]['value'];

interface FormState {
  name: string;
  trigger_type: AutomationTrigger;
  stage: string;
  amount: number;
  unit: TimeUnit;
  action_type: AutomationAction;
  notify: string;
  assign_to: string;
  due_hours: number;
  title: string;
  body: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  trigger_type: 'parado_na_etapa',
  stage: 'novo_lead',
  amount: 30,
  unit: 'minutos',
  action_type: 'notificar',
  notify: 'responsavel',
  assign_to: 'responsavel',
  due_hours: 24,
  title: '',
  body: '',
};

function minutesToForm(minutes: number): { amount: number; unit: TimeUnit } {
  if (minutes % 1440 === 0 && minutes >= 1440) return { amount: minutes / 1440, unit: 'dias' };
  if (minutes % 60 === 0 && minutes >= 60) return { amount: minutes / 60, unit: 'horas' };
  return { amount: minutes, unit: 'minutos' };
}

function ruleToForm(rule: AutomationRule): FormState {
  const trigger = (rule.trigger_config ?? {}) as { stage?: string; minutes?: number };
  const action = (rule.action_config ?? {}) as {
    notify?: string;
    assign_to?: string;
    due_hours?: number;
    title?: string;
    body?: string;
  };
  const { amount, unit } = minutesToForm(trigger.minutes ?? 30);
  return {
    name: rule.name,
    trigger_type: rule.trigger_type,
    stage: trigger.stage ?? 'novo_lead',
    amount,
    unit,
    action_type: rule.action_type,
    notify: action.notify ?? 'responsavel',
    assign_to: action.assign_to ?? 'responsavel',
    due_hours: action.due_hours ?? 24,
    title: action.title ?? '',
    body: action.body ?? '',
  };
}

/** Resumo em linguagem natural exibido no card da regra. */
function describeRule(rule: AutomationRule, stages: StageOption[]): string {
  const trigger = (rule.trigger_config ?? {}) as { stage?: string; minutes?: number };
  const stageName = stages.find((s) => s.slug === trigger.stage)?.name ?? trigger.stage;
  const when = (() => {
    switch (rule.trigger_type) {
      case 'lead_criado':
        return 'Quando um lead novo entrar';
      case 'entrou_etapa':
        return `Quando o lead entrar em "${stageName}"`;
      case 'parado_na_etapa': {
        const { amount, unit } = minutesToForm(trigger.minutes ?? 30);
        return `Quando o lead ficar ${amount} ${unit} parado em "${stageName}"`;
      }
      case 'visita_amanha':
        return 'Um dia antes de cada visita marcada';
      case 'sem_resposta': {
        const { amount, unit } = minutesToForm(trigger.minutes ?? 30);
        return `Quando a família esperar resposta há mais de ${amount} ${unit}`;
      }
    }
  })();
  const then = (() => {
    switch (rule.action_type) {
      case 'notificar':
        return 'notificar a equipe';
      case 'criar_tarefa':
        return 'criar uma tarefa';
      case 'enviar_whatsapp':
        return 'enviar WhatsApp';
    }
  })();
  return `${when} → ${then}`;
}

export function AutomationsManager({ rules, stages, users }: AutomationsManagerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isPending, startTransition] = useTransition();

  const needsStage = form.trigger_type === 'entrou_etapa' || form.trigger_type === 'parado_na_etapa';
  const needsTime = form.trigger_type === 'parado_na_etapa' || form.trigger_type === 'sem_resposta';

  const placeholders = useMemo(() => {
    const base = ['{{lead_name}}', '{{child_name}}'];
    if (form.trigger_type === 'visita_amanha') base.push('{{visit_time}}');
    return base.join(', ');
  }, [form.trigger_type]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(rule: AutomationRule) {
    setEditing(rule);
    setForm(ruleToForm(rule));
    setModalOpen(true);
  }

  function submit() {
    if (!form.name.trim()) {
      toast.error('Dê um nome para a automação.');
      return;
    }
    const unitFactor = TIME_UNITS.find((u) => u.value === form.unit)?.factor ?? 1;
    const triggerConfig: Record<string, unknown> = { pipeline: 'comercial' };
    if (needsStage) triggerConfig.stage = form.stage;
    if (needsTime) triggerConfig.minutes = Math.max(1, Math.round(form.amount * unitFactor));

    const actionConfig: Record<string, unknown> = {
      title: form.title.trim() || form.name.trim(),
      body: form.body.trim(),
    };
    if (form.action_type === 'notificar') actionConfig.notify = form.notify;
    if (form.action_type === 'criar_tarefa') {
      actionConfig.assign_to = form.assign_to;
      actionConfig.due_hours = form.due_hours;
    }

    const input = {
      name: form.name.trim(),
      is_active: editing?.is_active ?? true,
      trigger_type: form.trigger_type,
      trigger_config: triggerConfig as never,
      action_type: form.action_type,
      action_config: actionConfig as never,
    };

    startTransition(async () => {
      const result = editing
        ? await updateAutomationRule(editing.id, input)
        : await createAutomationRule(input);
      if (!result.ok) {
        toast.error(result.error ?? 'Não foi possível salvar a automação.');
        return;
      }
      toast.success(editing ? 'Automação atualizada.' : 'Automação criada.');
      setModalOpen(false);
    });
  }

  function toggle(rule: AutomationRule) {
    startTransition(async () => {
      const result = await toggleAutomationRule(rule.id, !rule.is_active);
      if (!result.ok) toast.error(result.error ?? 'Não foi possível alterar a automação.');
    });
  }

  function remove(rule: AutomationRule) {
    if (!window.confirm(`Excluir a automação "${rule.name}"?`)) return;
    startTransition(async () => {
      const result = await deleteAutomationRule(rule.id);
      if (!result.ok) toast.error(result.error ?? 'Não foi possível excluir a automação.');
      else toast.success('Automação excluída.');
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-brand-700">Automações</h2>
          <p className="text-sm text-brand-400">
            Alertas, follow-ups e lembretes que rodam sozinhos a cada 5 minutos.
          </p>
        </div>
        <Button onClick={openCreate}>Nova automação</Button>
      </div>

      {rules.length === 0 ? (
        <Card className="p-8 text-center text-sm text-brand-400">
          Nenhuma automação criada ainda. Clique em “Nova automação” para começar.
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map((rule) => (
            <Card key={rule.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-brand-700">{rule.name}</p>
                  <Badge tone={rule.is_active ? 'success' : 'neutral'}>
                    {rule.is_active ? 'Ativa' : 'Pausada'}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-sm text-brand-400">
                  {describeRule(rule, stages)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => toggle(rule)} disabled={isPending}>
                  {rule.is_active ? 'Pausar' : 'Ativar'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => openEdit(rule)}>
                  Editar
                </Button>
                <Button variant="danger" size="sm" onClick={() => remove(rule)} disabled={isPending}>
                  Excluir
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar automação' : 'Nova automação'}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Nome da automação"
            name="automation-name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Ex.: Lembrete de visita"
          />

          <div className="rounded-md border border-brand-100 bg-brand-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-400">
              Quando…
            </p>
            <div className="flex flex-col gap-3">
              <Select
                name="trigger-type"
                value={form.trigger_type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, trigger_type: e.target.value as AutomationTrigger }))
                }
              >
                {(Object.keys(TRIGGER_LABELS) as AutomationTrigger[]).map((key) => (
                  <option key={key} value={key}>
                    {TRIGGER_LABELS[key]}
                  </option>
                ))}
              </Select>
              {needsStage && (
                <Select
                  label="Etapa"
                  name="trigger-stage"
                  value={form.stage}
                  onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}
                >
                  {stages.map((stage) => (
                    <option key={stage.slug} value={stage.slug}>
                      {stage.name}
                    </option>
                  ))}
                </Select>
              )}
              {needsTime && (
                <div className="flex items-end gap-2">
                  <Input
                    label="Tempo"
                    name="trigger-amount"
                    type="number"
                    min={1}
                    className="w-24"
                    value={form.amount}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, amount: Number(e.target.value) || 1 }))
                    }
                  />
                  <Select
                    name="trigger-unit"
                    value={form.unit}
                    onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value as TimeUnit }))}
                  >
                    {TIME_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-md border border-brand-100 bg-brand-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-400">
              Então…
            </p>
            <div className="flex flex-col gap-3">
              <Select
                name="action-type"
                value={form.action_type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, action_type: e.target.value as AutomationAction }))
                }
              >
                {(Object.keys(ACTION_LABELS) as AutomationAction[]).map((key) => (
                  <option key={key} value={key} disabled={key === 'enviar_whatsapp'}>
                    {ACTION_LABELS[key]}
                  </option>
                ))}
              </Select>

              {form.action_type === 'notificar' && (
                <Select
                  label="Notificar quem?"
                  name="action-notify"
                  value={form.notify}
                  onChange={(e) => setForm((f) => ({ ...f, notify: e.target.value }))}
                >
                  <option value="responsavel">Responsável pelo lead</option>
                  <option value="todos">Toda a equipe</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </Select>
              )}

              {form.action_type === 'criar_tarefa' && (
                <div className="flex flex-col gap-3">
                  <Select
                    label="Tarefa para quem?"
                    name="action-assign"
                    value={form.assign_to}
                    onChange={(e) => setForm((f) => ({ ...f, assign_to: e.target.value }))}
                  >
                    <option value="responsavel">Responsável pelo lead</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    label="Prazo (horas após o disparo)"
                    name="action-due"
                    type="number"
                    min={1}
                    className="w-32"
                    value={form.due_hours}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, due_hours: Number(e.target.value) || 24 }))
                    }
                  />
                </div>
              )}

              <Input
                label="Título"
                name="action-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Ex.: Visita amanhã"
              />
              <Textarea
                label="Mensagem"
                name="action-body"
                rows={3}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="Ex.: Visita de {{lead_name}} amanhã às {{visit_time}}."
              />
              <p className="text-xs text-brand-400">
                Você pode usar: <code className="text-brand-600">{placeholders}</code>
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending ? 'Salvando…' : 'Salvar automação'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
