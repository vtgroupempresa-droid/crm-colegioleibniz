'use client';

import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { labelForField } from '@/lib/leads/validators';

interface SoftBlockModalProps {
  open: boolean;
  onClose: () => void;
  /** Nome do stage de destino, ex: "Agendado". */
  targetStageName: string;
  missing: readonly string[];
  /** Abre o modal de preenchimento (drawer). */
  onFillNow: () => void;
  /** Continua o move sem preencher (force=true). */
  onAdvanceAnyway: () => void;
  isPending: boolean;
}

/**
 * Modal de confirmação que substitui o "hard block" da Fase 2. Aparece quando
 * o SDR tenta mover um lead para um stage com required_fields pendentes que
 * NÃO são estruturais (lost_reason, churn_reason, nps_score).
 *
 * Dois caminhos:
 *  - "Preencher agora" → fecha o modal, abre o drawer para o usuário editar.
 *  - "Avançar mesmo assim" → chama moveLeadStage com force=true; o backend
 *    registra activity 'system' listando os campos pendentes.
 */
export function SoftBlockModal({
  open,
  onClose,
  targetStageName,
  missing,
  onFillNow,
  onAdvanceAnyway,
  isPending,
}: SoftBlockModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Avançar para "${targetStageName}" sem ICP completo?`}
      maxWidthClassName="max-w-md"
    >
      <p className="text-sm text-brand-500">
        Os campos abaixo ainda não estão preenchidos. Você pode avançar mesmo
        assim — ficará registrado na timeline do lead.
      </p>
      <ul className="mt-3 list-disc pl-5 text-sm text-brand-700">
        {missing.map((field) => (
          <li key={field}>{labelForField(field)}</li>
        ))}
      </ul>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
          Cancelar
        </Button>
        <Button type="button" variant="secondary" onClick={onFillNow} disabled={isPending}>
          Preencher agora
        </Button>
        <Button type="button" onClick={onAdvanceAnyway} disabled={isPending}>
          {isPending ? 'Movendo...' : 'Avançar mesmo assim'}
        </Button>
      </div>
    </Modal>
  );
}
