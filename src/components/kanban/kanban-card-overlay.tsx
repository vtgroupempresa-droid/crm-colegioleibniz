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
  const budget = lead.monthly_budget == null ? 'Não informado' : formatBRL(lead.monthly_budget);

  return (
    <div className="w-72 rotate-1 cursor-grabbing rounded-xl border border-brand-300 bg-white p-3.5 shadow-2xl ring-2 ring-brand-300/60">
      <p className="whitespace-normal break-words text-[15px] font-semibold leading-5 text-brand-800 [overflow-wrap:anywhere]">
        {lead.name}
      </p>
      <div className="mt-3 border-t border-brand-100 pt-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-400">
          Orçamento mensal
        </p>
        <p
          className={cn(
            'mt-0.5 break-words text-sm font-semibold [overflow-wrap:anywhere]',
            lead.monthly_budget == null ? 'text-brand-400' : 'text-brand-700',
          )}
        >
          {budget}
        </p>
      </div>
    </div>
  );
}
