'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import type { PipelineStageOption } from '@/actions/leads-queries';
import { PIPELINES, PIPELINE_LABELS, type PipelineKind } from '@/types/pipeline';

interface MoveLeadsModalProps {
  open: boolean;
  onClose: () => void;
  count: number;
  defaultPipeline: PipelineKind;
  /** Stages ativos por pipeline (slug + nome), para o seletor de coluna. */
  stagesByPipeline: Record<string, PipelineStageOption[]>;
  isPending: boolean;
  onConfirm: (pipeline: PipelineKind, stage: string) => void;
}

/**
 * Modal do botão "Mover" do board: escolhe pipeline + coluna de destino e move
 * todos os leads selecionados de uma vez (inclusive para outro pipeline).
 */
export function MoveLeadsModal({
  open,
  onClose,
  count,
  defaultPipeline,
  stagesByPipeline,
  isPending,
  onConfirm,
}: MoveLeadsModalProps) {
  const [pipeline, setPipeline] = useState<PipelineKind>(defaultPipeline);
  const stages = stagesByPipeline[pipeline] ?? [];
  const [stage, setStage] = useState<string>(stages[0]?.slug ?? '');

  function handlePipelineChange(next: PipelineKind) {
    setPipeline(next);
    setStage((stagesByPipeline[next] ?? [])[0]?.slug ?? '');
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!stage) return;
    onConfirm(pipeline, stage);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Mover ${count} ${count === 1 ? 'lead' : 'leads'}`}
      maxWidthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Select
          label="Pipeline de destino"
          value={pipeline}
          onChange={(e) => handlePipelineChange(e.target.value as PipelineKind)}
        >
          {PIPELINES.map((p) => (
            <option key={p} value={p}>
              {PIPELINE_LABELS[p]}
            </option>
          ))}
        </Select>
        <Select
          label="Coluna de destino"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          required
        >
          {stages.length === 0 && <option value="">—</option>}
          {stages.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </Select>
        <p className="rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-500">
          Leads que exigem motivo de perda (ex.: Venda Perdida) são pulados e
          precisam ser movidos individualmente.
        </p>
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending || !stage}>
            {isPending ? 'Movendo...' : 'Mover'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
