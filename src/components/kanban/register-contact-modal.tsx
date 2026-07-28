'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { recordSdrContact } from '@/actions/contact-attempts';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  SDR_CONTACT_RESULTS,
  SDR_CONTACT_RESULT_LABELS,
  type SdrContactResult,
} from '@/types/sdr-contact';

interface RegisterContactModalProps {
  open: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
  /** Resultado 'qualificado — agendar' → abrir o modal de agendamento. */
  onSchedule: () => void;
}

const HINTS: Record<SdrContactResult, string | null> = {
  no_answer: 'Avança o card para o próximo follow-up.',
  qualifying: 'Mantém o lead no stage atual.',
  qualified_schedule: 'Você será direcionado para o agendamento (closer, data e horário).',
  no_profile: 'Move o lead para a coluna Descartados (sem marcar como perdido).',
  call_later: 'Mantém o lead e reprograma o SLA como lembrete.',
};

/**
 * Mini-modal de ação rápida "Registrar contato" do card SDR/Captação
 * (Correção 1). Registra o resultado e roteia o stage; para os resultados que
 * transicionam de fluxo, abre o modal seguinte (agendamento/lost).
 */
export function RegisterContactModal({
  open,
  onClose,
  leadId,
  leadName,
  onSchedule,
}: RegisterContactModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SdrContactResult>('no_answer');
  const [notes, setNotes] = useState('');

  function reset() {
    setResult('no_answer');
    setNotes('');
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const res = await recordSdrContact({ leadId, result, notes: notes.trim() || null });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      reset();
      onClose();
      if (res.data.nextAction === 'schedule') {
        onSchedule();
      } else {
        toast.success(
          res.data.movedTo === 'sdr_descartados'
            ? 'Lead movido para Descartados'
            : 'Contato registrado',
        );
        router.refresh();
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Registrar contato · ${leadName}`}
      maxWidthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Select
          label="Resultado do contato"
          value={result}
          onChange={(e) => setResult(e.target.value as SdrContactResult)}
          required
        >
          {SDR_CONTACT_RESULTS.map((r) => (
            <option key={r} value={r}>
              {SDR_CONTACT_RESULT_LABELS[r]}
            </option>
          ))}
        </Select>
        <Textarea
          label="Observação (opcional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="O que aconteceu no contato..."
        />
        {HINTS[result] && (
          <p className="rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-600">
            {HINTS[result]}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Salvando...' : 'Salvar e mover stage'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
