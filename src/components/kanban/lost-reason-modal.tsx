'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { markLost } from '@/actions/deals';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LOST_REASONS, LOST_REASON_LABELS, type LostReason } from '@/types/lead';

interface LostReasonModalProps {
  open: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
  /** Disparado só após salvar com sucesso (ex.: fechar o LeadDrawer). */
  onSuccess?: () => void;
}

/**
 * Modal obrigatório de motivo da perda (Fase 4). Salvar só fica habilitado quando
 * o usuário escolhe um motivo do enum — proibido texto livre.
 *
 * Pós-salvamento, a Server Action `markLost` decide o destino:
 *  - `nao_e_medico` / `numero_invalido` → arquiva o lead (lixo).
 *  - Demais motivos → move para o pipeline `reativacao`.
 */
export function LostReasonModal({
  open,
  onClose,
  leadId,
  leadName,
  onSuccess,
}: LostReasonModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lostReason, setLostReason] = useState<LostReason | ''>('');
  const [notes, setNotes] = useState('');

  function reset() {
    setLostReason('');
    setNotes('');
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!lostReason) {
      toast.error('Selecione um motivo');
      return;
    }
    startTransition(async () => {
      const result = await markLost({
        leadId,
        lostReason,
        notes: notes.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.archived) {
        toast.success('Lead arquivado (fora do ICP)');
      } else {
        toast.success('Lead movido para reativação');
      }
      reset();
      onClose();
      onSuccess?.();
      router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Marcar como perdido · ${leadName}`}
      maxWidthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Select
          label="Motivo da perda"
          value={lostReason}
          onChange={(e) => setLostReason(e.target.value as LostReason | '')}
          required
        >
          <option value="">Selecione um motivo...</option>
          {LOST_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {LOST_REASON_LABELS[reason]}
            </option>
          ))}
        </Select>
        <Textarea
          label="Observações (opcional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Contexto adicional para o time..."
        />

        {lostReason === 'numero_invalido' && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Esse motivo arquiva o lead — o contato não é reaproveitável.
          </p>
        )}
        {lostReason && lostReason !== 'numero_invalido' && (
          <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
            O lead vai para <strong>Perdido</strong> e segue consultável para campanhas de
            rematrícula.
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" disabled={isPending || !lostReason}>
            {isPending ? 'Salvando...' : 'Confirmar perda'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
