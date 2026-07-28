'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createContactAttempt } from '@/actions/contact-attempts';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MAX_ATTEMPTS } from '@/lib/sla/rules';
import {
  CONTACT_CHANNELS,
  CONTACT_CHANNEL_LABELS,
  CONTACT_OUTCOMES,
  CONTACT_OUTCOME_LABELS,
  type ContactChannel,
  type ContactOutcome,
} from '@/types/lead';

interface ContactAttemptModalProps {
  open: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
  /** Última tentativa registrada (vai virar attempt N+1). */
  currentAttemptCount: number;
  /**
   * Chamado quando o outcome foi 'scheduled' — a página SDR deve abrir o
   * modal de handoff em seguida (closer + data).
   */
  onScheduledOutcome: () => void;
}

/**
 * Mini-modal de "Registrar tentativa" disparado pelo botão de ação rápida no
 * card SDR. Não substitui o drawer — é só para registrar a tentativa rápida.
 */
export function ContactAttemptModal({
  open,
  onClose,
  leadId,
  leadName,
  currentAttemptCount,
  onScheduledOutcome,
}: ContactAttemptModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [channel, setChannel] = useState<ContactChannel>('whatsapp');
  const [outcome, setOutcome] = useState<ContactOutcome>('no_answer');
  const [notes, setNotes] = useState('');

  const nextNumber = currentAttemptCount + 1;
  const willMoveToReactivation =
    nextNumber === MAX_ATTEMPTS && outcome !== 'responded' && outcome !== 'scheduled';

  function reset() {
    setChannel('whatsapp');
    setOutcome('no_answer');
    setNotes('');
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createContactAttempt({
        leadId,
        channel,
        outcome,
        notes: notes.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (result.data.movedToReactivation) {
        toast.success(`Tentativa ${result.data.attemptNumber}/${MAX_ATTEMPTS} · lead movido para reativação`);
      } else {
        toast.success(`Tentativa ${result.data.attemptNumber}/${MAX_ATTEMPTS} registrada`);
      }
      reset();
      onClose();

      if (outcome === 'scheduled') {
        onScheduledOutcome();
      } else {
        router.refresh();
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Tentativa ${nextNumber}/${MAX_ATTEMPTS} · ${leadName}`}
      maxWidthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Select
          label="Canal"
          value={channel}
          onChange={(e) => setChannel(e.target.value as ContactChannel)}
          required
        >
          {CONTACT_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CONTACT_CHANNEL_LABELS[c]}
            </option>
          ))}
        </Select>
        <Select
          label="Resultado"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as ContactOutcome)}
          required
        >
          {CONTACT_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {CONTACT_OUTCOME_LABELS[o]}
            </option>
          ))}
        </Select>
        <Textarea
          label="Notas (opcional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Não atendeu, retornar mais tarde..."
        />

        {willMoveToReactivation && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Esta é a 8ª tentativa sem resposta. O lead será movido automaticamente
            para o pipeline de <strong>Reativação</strong>.
          </p>
        )}
        {outcome === 'scheduled' && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            Você será direcionado para o agendamento (escolher closer, data e horário).
          </p>
        )}

        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onClose}
            disabled={isPending}
            className="w-full sm:h-10 sm:w-auto sm:px-4 sm:text-sm"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            size="lg"
            disabled={isPending}
            className="w-full sm:h-10 sm:w-auto sm:px-4 sm:text-sm"
          >
            {isPending ? 'Salvando...' : 'Registrar tentativa'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
