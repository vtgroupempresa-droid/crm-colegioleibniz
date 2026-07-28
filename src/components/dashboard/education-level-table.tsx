'use client';

import { useMemo, useState } from 'react';
import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt, formatPercent } from '@/lib/dashboard/format';
import { formatBRL } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { EDUCATION_LEVEL_LABELS } from '@/types/lead';
import type { EducationLevelRow } from '@/types/dashboard';

type SortKey =
  | keyof Pick<EducationLevelRow, 'leads' | 'enrollments' | 'conversionRate' | 'avgTicket'>
  | 'level';

type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'level', label: 'Nível de ensino', numeric: false },
  { key: 'leads', label: 'Leads', numeric: true },
  { key: 'enrollments', label: 'Matrículas', numeric: true },
  { key: 'conversionRate', label: 'Conversão', numeric: true },
  { key: 'avgTicket', label: 'Ticket médio', numeric: true },
];

function label(row: EducationLevelRow): string {
  return row.level ? EDUCATION_LEVEL_LABELS[row.level] : 'Sem nível informado';
}

function cmpNum(a: number | null, b: number | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls sempre por último
  if (b === null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

export function EducationLevelTable({ rows }: { rows: EducationLevelRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('leads');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortKey === 'level') {
        const cmp = label(a).localeCompare(label(b), 'pt-BR');
        return sortDir === 'asc' ? cmp : -cmp;
      }
      return cmpNum(a[sortKey] as number | null, b[sortKey] as number | null, sortDir);
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'level' ? 'asc' : 'desc');
    }
  }

  const headers = COLUMNS.map((c) => c.label);
  const csvRows: CsvCell[][] = sorted.map((r) => [
    label(r),
    r.leads,
    r.enrollments,
    formatPercent(r.conversionRate),
    r.avgTicket === null ? '' : formatBRL(r.avgTicket),
  ]);

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Performance por nível de ensino
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">Clique no cabeçalho para ordenar.</p>
        </div>
        <ExportButton filename="performance-nivel-ensino" headers={headers} rows={csvRows} />
      </div>

      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-brand-400">Sem dados no período.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-brand-500">
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} className={cn('pb-2', col.numeric ? 'pr-3 text-right' : 'pr-3')}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        'focus-ring inline-flex items-center gap-1 rounded hover:text-brand-700',
                        col.numeric && 'flex-row-reverse',
                      )}
                    >
                      {col.label}
                      <span className="text-[9px]">
                        {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {sorted.map((r) => (
                <tr key={r.level ?? 'sem'}>
                  <td className="py-2 pr-3 font-medium text-brand-700">{label(r)}</td>
                  <td className="py-2 pr-3 text-right text-brand-700">{formatInt(r.leads)}</td>
                  <td className="py-2 pr-3 text-right text-brand-700">
                    {formatInt(r.enrollments)}
                  </td>
                  <td className="py-2 pr-3 text-right text-brand-600">
                    {formatPercent(r.conversionRate)}
                  </td>
                  <td className="py-2 text-right text-brand-600">
                    {r.avgTicket === null ? '—' : formatBRL(r.avgTicket)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
