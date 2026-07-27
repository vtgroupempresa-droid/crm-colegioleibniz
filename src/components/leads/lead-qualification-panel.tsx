'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { saveLeadQualification } from '@/actions/lead-qualification';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/cn';
import {
  LEAD_QUALIFICATION_LABELS,
  LEAD_QUALIFICATION_NEXT_ACTION_LABELS,
  LEAD_QUALIFICATION_NEXT_ACTIONS,
  LEAD_QUALIFICATION_STATUSES,
  isLeadQualificationNextAction,
  isLeadQualificationStatus,
  type Lead,
  type LeadQualificationNextAction,
  type LeadQualificationStatus,
} from '@/types/lead';

interface LeadQualificationPanelProps {
  lead: Lead;
  onMutated?: () => void | Promise<void>;
}

function toDateTimeLocal(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatNextActionDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Qualificação rápida no topo do drawer. O estado atual facilita a leitura;
 * cada salvamento também cria uma activity "qualification" no banco.
 */
export function LeadQualificationPanel({ lead, onMutated }: LeadQualificationPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<LeadQualificationStatus | null>(null);
  const [description, setDescription] = useState('');
  const [nextAction, setNextAction] = useState<LeadQualificationNextAction | null>(null);
  const [nextActionAt, setNextActionAt] = useState('');

  useEffect(() => {
    setStatus(isLeadQualificationStatus(lead.qualification_status) ? lead.qualification_status : null);
    setDescription(lead.qualification_note ?? '');
    setNextAction(
      isLeadQualificationNextAction(lead.qualification_next_action)
        ? lead.qualification_next_action
        : null,
    );
    setNextActionAt(toDateTimeLocal(lead.qualification_next_action_at));
  }, [
    lead.id,
    lead.qualification_next_action,
    lead.qualification_next_action_at,
    lead.qualification_note,
    lead.qualification_status,
  ]);

  const savedStatus = isLeadQualificationStatus(lead.qualification_status)
    ? lead.qualification_status
    : null;
  const savedNextAction = isLeadQualificationNextAction(lead.qualification_next_action)
    ? lead.qualification_next_action
    : null;
  const savedNextActionDate = formatNextActionDate(lead.qualification_next_action_at);

  function handleSave() {
    if (!status) {
      toast.error('Escolha como foi o atendimento');
      return;
    }
    if (status === 'outro' && !description.trim()) {
      toast.error('Descreva a situação ao escolher Outro');
      return;
    }

    const nextActionAtIso = nextActionAt ? new Date(nextActionAt).toISOString() : null;
    startTransition(async () => {
      const result = await saveLeadQualification({
        leadId: lead.id,
        status,
        description: description.trim(),
        nextAction,
        nextActionAt: nextActionAtIso,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Resumo do atendimento salvo');
      await onMutated?.();
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-brand-200 bg-brand-50/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-brand-700">Resumo do atendimento</h3>
          <p className="text-xs text-brand-500">
            Registre a percepção da conversa e o próximo passo sem sair do lead.
          </p>
        </div>
        {savedStatus && <Badge tone="brand">{LEAD_QUALIFICATION_LABELS[savedStatus]}</Badge>}
      </div>

      {savedStatus && (
        <div className="mt-3 rounded-md border border-brand-100 bg-white px-3 py-2">
          <p className="text-xs font-medium text-brand-600">Última descrição</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-brand-700">
            {lead.qualification_note ?? LEAD_QUALIFICATION_LABELS[savedStatus]}
          </p>
          {savedNextAction && (
            <p className="mt-1 text-xs text-brand-500">
              Próximo passo: {LEAD_QUALIFICATION_NEXT_ACTION_LABELS[savedNextAction]}
              {savedNextActionDate ? ` · ${savedNextActionDate}` : ''}
            </p>
          )}
        </div>
      )}

      <div className="mt-3" role="group" aria-label="Como foi o atendimento?">
        <p className="mb-1.5 text-xs font-medium text-brand-600">Como foi o atendimento?</p>
        <div className="flex flex-wrap gap-1.5">
          {LEAD_QUALIFICATION_STATUSES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={status === option}
              onClick={() => setStatus(option)}
              className={cn(
                'focus-ring rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors',
                status === option
                  ? 'border-brand-600 bg-brand-700 text-canvas'
                  : 'border-brand-200 bg-white text-brand-600 hover:border-brand-400 hover:bg-brand-100',
              )}
            >
              {LEAD_QUALIFICATION_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <Textarea
          label="Descrição da conversa"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Ex.: Gostou da proposta, mas precisa confirmar a decisão com a família até sexta."
          rows={3}
          maxLength={2000}
        />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Select
          label="Próximo passo (opcional)"
          value={nextAction ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            setNextAction(isLeadQualificationNextAction(value) ? value : null);
            if (!value) setNextActionAt('');
          }}
        >
          <option value="">Sem próximo passo definido</option>
          {LEAD_QUALIFICATION_NEXT_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {LEAD_QUALIFICATION_NEXT_ACTION_LABELS[action]}
            </option>
          ))}
        </Select>
        <Input
          label="Quando retornar? (opcional)"
          type="datetime-local"
          value={nextActionAt}
          onChange={(event) => setNextActionAt(event.target.value)}
          disabled={!nextAction}
        />
      </div>

      <div className="mt-3 flex justify-end">
        <Button type="button" size="sm" onClick={handleSave} disabled={isPending || !status}>
          {isPending ? 'Salvando...' : 'Salvar atualização'}
        </Button>
      </div>
    </section>
  );
}
