'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils/cn';
import type { KanbanStage } from './kanban-board';

interface MoveLeadStageModalProps {
  open: boolean;
  onClose: () => void;
  leadName: string;
  currentStage: string;
  stages: readonly KanbanStage[];
  isPending: boolean;
  onConfirm: (stage: string) => void;
}

/**
 * Caminho de movimento orientado a toque. Evita exigir que uma pessoa arraste
 * um card por uma lista longa de colunas no celular, mas segue as mesmas
 * validações do arraste ao confirmar o destino.
 */
export function MoveLeadStageModal({
  open,
  onClose,
  leadName,
  currentStage,
  stages,
  isPending,
  onConfirm,
}: MoveLeadStageModalProps) {
  const [targetStage, setTargetStage] = useState(currentStage);

  useEffect(() => {
    if (open) setTargetStage(currentStage);
  }, [currentStage, open]);

  const orderedStages = [...stages].sort((a, b) => a.position - b.position);

  return (
    <Modal
      open={open}
      onClose={onClose}
      placement="bottom"
      title="Mover família para uma etapa"
      maxWidthClassName="max-w-lg"
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-brand-500">
          Escolha onde a família de <strong className="font-semibold text-brand-700">{leadName}</strong>{' '}
          está na jornada de matrícula.
        </p>
        <div className="grid gap-2">
          {orderedStages.map((stage) => {
            const isCurrent = stage.slug === currentStage;
            const isSelected = stage.slug === targetStage;
            return (
              <button
                key={stage.slug}
                type="button"
                disabled={isCurrent || isPending}
                onClick={() => setTargetStage(stage.slug)}
                className={cn(
                  'focus-ring flex min-h-12 items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors',
                  isSelected
                    ? 'border-brand-600 bg-brand-700 text-canvas'
                    : 'border-brand-200 bg-white text-brand-700 hover:bg-brand-50',
                  isCurrent && 'cursor-default border-brand-100 bg-brand-50 text-brand-400',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                  <span className="text-sm font-medium">{stage.name}</span>
                </span>
                {isCurrent ? (
                  <span className="text-xs">Etapa atual</span>
                ) : isSelected ? (
                  <span aria-hidden>✓</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-brand-400">
          Se a etapa exigir visita, motivo ou algum dado, o CRM orientará o próximo passo.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm(targetStage)}
            disabled={isPending || targetStage === currentStage}
          >
            {isPending ? 'Movendo…' : 'Confirmar etapa'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
