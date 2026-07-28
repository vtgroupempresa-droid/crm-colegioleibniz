import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatDays, formatInt, formatPercent } from '@/lib/dashboard/format';
import { LEAD_SOURCE_LABELS } from '@/types/lead';
import type { SourceRow } from '@/types/dashboard';

function label(row: SourceRow): string {
  return row.source ? LEAD_SOURCE_LABELS[row.source] : 'Sem origem';
}

export function SourceTable({ rows }: { rows: SourceRow[] }) {
  const headers = [
    'Origem',
    'Volume de leads',
    'Conversão',
    'Interesse alto',
    'Ciclo médio',
  ];
  const csvRows: CsvCell[][] = rows.map((r) => [
    label(r),
    r.leads,
    formatPercent(r.conversionRate),
    formatPercent(r.highInterestRate),
    formatDays(r.avgCycleDays),
  ]);

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Performance por origem
        </h3>
        <ExportButton filename="performance-origem" headers={headers} rows={csvRows} />
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-brand-400">Sem dados no período.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-brand-500">
              <tr>
                <th className="pb-2 pr-3">Origem</th>
                <th className="pb-2 pr-3 text-right">Leads</th>
                <th className="pb-2 pr-3 text-right">Conversão</th>
                <th className="pb-2 pr-3 text-right">Interesse alto</th>
                <th className="pb-2 text-right">Ciclo médio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {rows.map((r) => (
                <tr key={r.source ?? 'sem'}>
                  <td className="py-2 pr-3 font-medium text-brand-700">{label(r)}</td>
                  <td className="py-2 pr-3 text-right text-brand-700">{formatInt(r.leads)}</td>
                  <td className="py-2 pr-3 text-right text-brand-600">
                    {formatPercent(r.conversionRate)}
                  </td>
                  <td className="py-2 pr-3 text-right text-brand-600">
                    {formatPercent(r.highInterestRate)}
                  </td>
                  <td className="py-2 text-right text-brand-600">{formatDays(r.avgCycleDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
