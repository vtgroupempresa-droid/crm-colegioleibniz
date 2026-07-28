import { AgentCell } from '@/components/dashboard/agent-cell';
import { ExportButton } from '@/components/dashboard/export-button';
import { Badge } from '@/components/ui/badge';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt, formatPercent } from '@/lib/dashboard/format';
import { formatBRL } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { LOST_REASON_LABELS } from '@/types/lead';
import type { CloserRow } from '@/types/dashboard';

function lostSummary(row: CloserRow): string {
  return row.lostBreakdown
    .map((l) => `${LOST_REASON_LABELS[l.reason]}: ${l.count}`)
    .join(' · ');
}

export function CloserTable({ rows }: { rows: CloserRow[] }) {
  const headers = [
    'Ranking',
    'Atendente',
    'Visitas',
    'Conversão',
    'Ticket médio',
    'No-show',
    'Faturamento',
    'Motivos de perda',
  ];
  const csvRows: CsvCell[][] = rows.map((r) => [
    `${r.rank}º`,
    r.name,
    r.calls,
    formatPercent(r.conversionRate),
    r.avgTicket === null ? '' : formatBRL(r.avgTicket),
    formatPercent(r.noShowRate),
    formatBRL(r.revenue),
    lostSummary(r),
  ]);

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Performance por atendente
        </h3>
        <ExportButton filename="performance-atendente" headers={headers} rows={csvRows} />
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-brand-400">Sem visitas registradas no período.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-brand-500">
              <tr>
                <th className="pb-2 pr-3">Atendente</th>
                <th className="pb-2 pr-3 text-right">Visitas</th>
                <th className="pb-2 pr-3 text-right">Conversão</th>
                <th className="pb-2 pr-3 text-right">Ticket médio</th>
                <th className="pb-2 pr-3 text-right">No-show</th>
                <th className="pb-2 pr-3 text-right">Faturamento</th>
                <th className="pb-2">Motivos de perda</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="py-2 pr-3">
                    <AgentCell name={r.name} avatarUrl={r.avatarUrl} rank={r.rank} />
                  </td>
                  <td className="py-2 pr-3 text-right text-brand-700">{formatInt(r.calls)}</td>
                  <td
                    className={cn(
                      'py-2 pr-3 text-right',
                      // Conversão alta ganha destaque verde (≥ 20% visita → matrícula).
                      r.conversionRate !== null && r.conversionRate >= 0.2
                        ? 'font-semibold text-emerald-700'
                        : 'text-brand-600',
                    )}
                  >
                    {formatPercent(r.conversionRate)}
                  </td>
                  <td className="py-2 pr-3 text-right text-brand-600">
                    {r.avgTicket === null ? '—' : formatBRL(r.avgTicket)}
                  </td>
                  <td className="py-2 pr-3 text-right text-brand-600">
                    {formatPercent(r.noShowRate)}
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold text-emerald-700">
                    {formatBRL(r.revenue)}
                  </td>
                  <td className="py-2">
                    {r.lostBreakdown.length === 0 ? (
                      <span className="text-xs text-brand-300">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {r.lostBreakdown.slice(0, 3).map((l) => (
                          <Badge key={l.reason} tone="danger">
                            {LOST_REASON_LABELS[l.reason]} {l.count}
                          </Badge>
                        ))}
                      </div>
                    )}
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
