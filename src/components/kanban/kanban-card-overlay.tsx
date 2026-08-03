'use client';

import { cn } from '@/lib/utils/cn';
import { formatBRL } from '@/lib/utils/format';
import type { Lead } from '@/types/lead';
import type { PipelineKind } from '@/types/pipeline';
import type { BoardDensity } from './use-board-density';

interface KanbanCardOverlayProps {
  lead: Lead;
  pipeline: PipelineKind;
  nextSlaAt: string | null;
  density?: BoardDensity;
  stageEnteredAt?: string | null;
  assigneeName?: string | null;
  assigneeRole?: string | null;
}

/** Cópia visual do mesmo padrão durante o arrasto. */
export function KanbanCardOverlay({ lead }: KanbanCardOverlayProps) {
  const budget = lead.budget == null ? 'Não informado' : formatBRL(lead.budget);

  return (
    <div className="w-72 rotate-1 cursor-grabbing rounded-xl border border-brand-300 bg-white p-3.5 shadow-2xl ring-2 ring-brand-300/60">
      <p className="whitespace-normal break-words text-[15px] font-semibold leading-5 text-brand-800 [overflow-wrap:anywhere]">
        {lead.name}
      </p>
      <span
        className={cn(
          'mt-2 inline-flex max-w-full items-center rounded-full px-2 py-1 text-[11px] font-semibold leading-none',
          lead.budget == null ? 'bg-brand-50 text-brand-400' : 'bg-emerald-50 text-emerald-700',
        )}
      >
        <span className="mr-1 font-medium opacity-75">Orçamento</span>
        <span className="break-words [overflow-wrap:anywhere]">{budget}</span>
      </span>
    </div>
  );
}
