'use client';

import { useMemo, useState } from 'react';
import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt, formatPercent } from '@/lib/dashboard/format';
import { LOST_REASON_LABELS, LOST_REASONS } from '@/types/lead';
import type { LostReasonItem } from '@/types/dashboard';

/**
 * Motivos de perda categorizados (enum fechado de 11 motivos), em seção própria
 * — dado essencial para evoluir o discurso comercial com dados reais. Segmentável
 * por atendente (filtro client-side sobre os itens do período).
 */
export function LostReasonsSection({ items }: { items: LostReasonItem[] }) {
  const [closerId, setCloserId] = useState('');

  const closers = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.closerId && item.closerName) map.set(item.closerId, item.closerName);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter((item) => !closerId || item.closerId === closerId),
    [items, closerId],
  );

  const breakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of filtered) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
    return LOST_REASONS.map((reason) => ({
      reason,
      label: LOST_REASON_LABELS[reason],
      count: counts.get(reason) ?? 0,
    }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  const total = filtered.length;
  const csvRows: CsvCell[][] = breakdown.map((r) => [
    r.label,
    r.count,
    formatPercent(total > 0 ? r.count / total : null),
  ]);

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Motivos de perda
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Distribuição dos motivos no período — {formatInt(total)} perda{total === 1 ? '' : 's'}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-md border border-brand-200 px-2 py-1.5 text-sm text-brand-600"
            value={closerId}
            onChange={(e) => setCloserId(e.target.value)}
          >
            <option value="">Toda a equipe</option>
            {closers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <ExportButton
            filename="motivos-de-perda"
            headers={['Motivo', 'Perdas', '% do total']}
            rows={csvRows}
          />
        </div>
      </div>

      {breakdown.length === 0 ? (
        <p className="mt-3 text-sm text-brand-400">Sem perdas registradas com esses filtros.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2.5">
          {breakdown.map((r) => {
            // Largura relativa ao motivo mais frequente (o 1º da lista ordenada).
            const maxCount = breakdown[0]?.count ?? 1;
            const widthPct = Math.max(6, Math.round((r.count / maxCount) * 100));
            return (
              <li key={r.reason} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 truncate text-brand-700" title={r.label}>
                  {r.label}
                </span>
                <span className="h-4 flex-1 overflow-hidden rounded-full bg-brand-50">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-red-400 to-red-600"
                    style={{ width: `${widthPct}%` }}
                    title={`${formatInt(r.count)} (${formatPercent(total > 0 ? r.count / total : null)})`}
                  />
                </span>
                <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-brand-700">
                  {formatInt(r.count)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
