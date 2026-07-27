'use client';

import { useMemo, useState } from 'react';
import { AgentCell } from '@/components/dashboard/agent-cell';
import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt, formatPercent } from '@/lib/dashboard/format';
import { formatBRL } from '@/lib/utils/format';
import type { IndividualPerformanceRow } from '@/types/dashboard';
import { cn } from '@/lib/utils/cn';
import { USER_ROLE_LABELS } from '@/types/user';

type SortKey = 'activity' | 'conversions' | 'conversionRate';

const ROLE_LABELS: Record<IndividualPerformanceRow['role'], string> = USER_ROLE_LABELS;

/**
 * Ranking da equipe ordenável por volume de atividade, conversões OU taxa
 * de conversão — ordenar só por volume distorce a leitura. Inclui meta do mês
 * (user_goals) com barra de progresso.
 */
export function PerformanceRankingTable({
  rows,
  goalMonthLabel,
}: {
  rows: IndividualPerformanceRow[];
  goalMonthLabel: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('conversionRate');

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (sortKey === 'conversionRate') return (b.conversionRate ?? -1) - (a.conversionRate ?? -1);
        return b[sortKey] - a[sortKey];
      }),
    [rows, sortKey],
  );

  const csvRows: CsvCell[][] = sorted.map((r, i) => [
    `${i + 1}º`,
    r.name,
    ROLE_LABELS[r.role],
    r.activity,
    r.conversions,
    formatPercent(r.conversionRate),
    r.revenue > 0 ? formatBRL(r.revenue) : '',
    formatPercent(r.goalProgress),
  ]);

  const sortButton = (key: SortKey, label: string): React.ReactNode => (
    <button
      type="button"
      onClick={() => setSortKey(key)}
      className={cn(
        'inline-flex items-center gap-1 uppercase',
        sortKey === key ? 'font-bold text-brand-700' : 'hover:text-brand-700',
      )}
    >
      {label}
      {sortKey === key && <span aria-hidden>↓</span>}
    </button>
  );

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Ranking — atividade, conversões e taxa
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Clique nos cabeçalhos para ordenar. Meta refere-se a {goalMonthLabel}.
          </p>
        </div>
        <ExportButton
          filename="performance-individual"
          headers={['Ranking', 'Pessoa', 'Cargo', 'Atividade', 'Matrículas', 'Taxa', 'Faturamento', 'Meta']}
          rows={csvRows}
        />
      </div>

      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-brand-400">Sem atividade no período.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-brand-500">
              <tr>
                <th className="pb-2 pr-3 uppercase">Pessoa</th>
                <th className="pb-2 pr-3 uppercase">Cargo</th>
                <th className="pb-2 pr-3 text-right">{sortButton('activity', 'Atividade')}</th>
                <th className="pb-2 pr-3 text-right">{sortButton('conversions', 'Conversões')}</th>
                <th className="pb-2 pr-3 text-right">{sortButton('conversionRate', 'Taxa')}</th>
                <th className="pb-2 pr-3 text-right uppercase">Faturamento</th>
                <th className="pb-2 uppercase">Meta do mês</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {sorted.map((r, i) => {
                const progress = r.goalProgress !== null ? Math.min(1, r.goalProgress) : null;
                return (
                  <tr key={r.userId}>
                    <td className="py-2 pr-3">
                      <AgentCell name={r.name} avatarUrl={r.avatarUrl} rank={i + 1} />
                    </td>
                    <td className="py-2 pr-3 text-brand-600">{ROLE_LABELS[r.role]}</td>
                    <td className="py-2 pr-3 text-right text-brand-600">{formatInt(r.activity)}</td>
                    <td className="py-2 pr-3 text-right text-brand-600">
                      {formatInt(r.conversions)}
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-brand-700">
                      {formatPercent(r.conversionRate)}
                    </td>
                    <td className="py-2 pr-3 text-right text-brand-600">
                      {r.revenue > 0 ? formatBRL(r.revenue) : '—'}
                    </td>
                    <td className="py-2">
                      {progress === null ? (
                        <span className="text-xs text-brand-400">sem meta</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-brand-50">
                            <div
                              className={cn(
                                'h-full',
                                progress >= 1 ? 'bg-emerald-500' : 'bg-brand-500',
                              )}
                              style={{ width: `${Math.round(progress * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-brand-500">
                            {formatPercent(r.goalProgress)}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
