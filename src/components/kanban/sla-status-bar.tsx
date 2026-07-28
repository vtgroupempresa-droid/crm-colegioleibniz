'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils/cn';
import { slaStatusFor } from '@/lib/sla/rules';
import type { KanbanLeadEntry } from './kanban-board';

interface SlaStatusBarProps {
  entries: readonly KanbanLeadEntry[];
  /** Filtro ativo: 'breached' | 'warning' | null. */
  activeFilter: 'breached' | 'warning' | null;
  onFilterChange: (next: 'breached' | 'warning' | null) => void;
}

/**
 * Barra de status de SLA do painel SDR. Mostra:
 *  - Vencidos (clicável, filtra o board)
 *  - Vencendo em 2h (clicável, filtra o board)
 *  - Tentativas registradas hoje (informativo, baseado em stageEnteredAt + outras
 *    métricas seriam ideais, mas usamos `attemptsCount` agregado nas entries).
 */
export function SlaStatusBar({ entries, activeFilter, onFilterChange }: SlaStatusBarProps) {
  const stats = useMemo(() => {
    let breached = 0;
    let warning = 0;
    let totalAttempts = 0;
    for (const entry of entries) {
      totalAttempts += entry.attemptsCount;
      const sla = slaStatusFor(entry.nextSlaAt);
      if (sla.status === 'breached') breached += 1;
      else if (sla.status === 'warning') warning += 1;
    }
    return { breached, warning, totalAttempts };
  }, [entries]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand-100 bg-white p-2 shadow-sm">
      <button
        type="button"
        onClick={() => onFilterChange(activeFilter === 'breached' ? null : 'breached')}
        className={cn(
          'focus-ring flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-left text-xs text-red-700 transition-colors hover:bg-red-100',
          activeFilter === 'breached' && 'bg-red-200 ring-2 ring-red-400',
        )}
      >
        <span className="text-sm font-semibold">{stats.breached}</span>
        <span>{stats.breached === 1 ? 'lead com SLA vencido' : 'leads com SLA vencido'}</span>
      </button>

      <button
        type="button"
        onClick={() => onFilterChange(activeFilter === 'warning' ? null : 'warning')}
        className={cn(
          'focus-ring flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-left text-xs text-amber-700 transition-colors hover:bg-amber-100',
          activeFilter === 'warning' && 'bg-amber-200 ring-2 ring-amber-400',
        )}
      >
        <span className="text-sm font-semibold">{stats.warning}</span>
        <span>{stats.warning === 1 ? 'lead com SLA em 2h' : 'leads com SLA em 2h'}</span>
      </button>

      <div className="ml-auto rounded-md border border-brand-100 bg-brand-50 px-3 py-1.5 text-xs text-brand-600">
        <span className="font-semibold">{stats.totalAttempts}</span>
        <span className="ml-1">{stats.totalAttempts === 1 ? 'tentativa registrada' : 'tentativas registradas'}</span>
      </div>
    </div>
  );
}
