'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { markNoShow } from '@/actions/appointments';
import { recordCallResult } from '@/actions/deals';
import { CALL_NEXT_ACTIONS, type CallNextAction } from '@/types/deal';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface CallResultModalProps {
  open: boolean;
  onClose: () => void;
  leadName: string;
  appointmentId: string;
  /** Disparado quando next_action='close_now' — UI deve abrir DealModal. */
  onCloseNow: () => void;
}

const NEXT_ACTION_LABELS: Record<CallNextAction, string> = {
  send_proposal: 'Enviar proposta → Follow-up de vendas',
  schedule_followup: 'Agendar nova call → Segunda call',
  close_now: 'Fechar agora → abrir modal de venda',
};

/**
 * Modal disparado pelo botão "Registrar call" no card do closer (stage =
 * agendamentos). Dois caminhos:
 *
 *  1) showed_up=false → `markNoShow` (lead volta pro SDR, -15pts).
 *  2) showed_up=true → exige call_notes + next_action. `recordCallResult`
 *     move o lead pro stage downstream (ou mantém para close_now, que
 *     abre o DealModal em seguida via callback).
 */
export function CallResultModal({
  open,
  onClose,
  leadName,
  appointmentId,
  onCloseNow,
}: CallResultModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showedUp, setShowedUp] = useState<'yes' | 'no'>('yes');
  const [callNotes, setCallNotes] = useState('');
  const [nextAction, setNextAction] = useState<CallNextAction>('send_proposal');

  function reset() {
    setShowedUp('yes');
    setCallNotes('');
    setNextAction('send_proposal');
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (showedUp === 'no') {
      startTransition(async () => {
        const result = await markNoShow(appointmentId);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success('No-show registrado · lead devolvido ao SDR');
        reset();
        onClose();
        router.refresh();
      });
      return;
    }

    if (!callNotes.trim()) {
      toast.error('Anote o que aconteceu na call');
      return;
    }

    startTransition(async () => {
      const result = await recordCallResult({
        appointmentId,
        callNotes: callNotes.trim(),
        nextAction,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (nextAction === 'close_now') {
        toast.success('Call registrada — abrindo modal de venda');
        reset();
        onClose();
        onCloseNow();
      } else {
        toast.success(`Movido para ${result.data.nextStage}`);
        reset();
        onClose();
        router.refresh();
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Registrar call · ${leadName}`}
      maxWidthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Select
          label="Compareceu?"
          value={showedUp}
          onChange={(e) => setShowedUp(e.target.value as 'yes' | 'no')}
          required
        >
          <option value="yes">Sim, fez a call</option>
          <option value="no">Não — marcar no-show</option>
        </Select>

        {showedUp === 'no' && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            O lead voltará para o SDR (stage <strong>no_show</strong>) e perderá 15pts no score.
            O SDR é responsável pela recuperação.
          </p>
        )}

        {showedUp === 'yes' && (
          <>
            <Textarea
              label="Anotações da call"
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              rows={4}
              required
              placeholder="Dores levantadas, objeções, próximos passos..."
            />
            <Select
              label="Próxima ação"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value as CallNextAction)}
              required
            >
              {CALL_NEXT_ACTIONS.map((act) => (
                <option key={act} value={act}>
                  {NEXT_ACTION_LABELS[act]}
                </option>
              ))}
            </Select>
          </>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant={showedUp === 'no' ? 'danger' : 'primary'}
            disabled={isPending}
          >
            {isPending
              ? 'Salvando...'
              : showedUp === 'no'
              ? 'Marcar no-show'
              : 'Registrar call'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
