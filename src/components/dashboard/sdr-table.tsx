import { AgentCell } from '@/components/dashboard/agent-cell';
import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt, formatMinutes, formatPercent } from '@/lib/dashboard/format';
import type { SdrRow } from '@/types/dashboard';

export function SdrTable({ rows }: { rows: SdrRow[] }) {
  const headers = [
    'Ranking',
    'Atendente',
    'Tentativas',
    'Taxa de contato',
    'Agendamentos',
    'Show rate',
    'SLA 1º contato',
    '% ICP completo',
  ];
  const csvRows: CsvCell[][] = rows.map((r) => [
    `${r.rank}º`,
    r.name,
    r.attempts,
    formatPercent(r.contactRate),
    r.appointments,
    formatPercent(r.showRate),
    formatMinutes(r.avgFirstContactMin),
    formatPercent(r.icpCompleteRate),
  ]);

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Performance no atendimento
        </h3>
        <ExportButton filename="performance-atendimento" headers={headers} rows={csvRows} />
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-brand-400">Sem atividade de atendimento no período.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-brand-500">
              <tr>
                <th className="pb-2 pr-3">Atendente</th>
                <th className="pb-2 pr-3 text-right">Tentativas</th>
                <th className="pb-2 pr-3 text-right">Taxa contato</th>
                <th className="pb-2 pr-3 text-right">Agendam.</th>
                <th className="pb-2 pr-3 text-right">Show rate</th>
                <th className="pb-2 pr-3 text-right">SLA 1º contato</th>
                <th className="pb-2 text-right">ICP completo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="py-2 pr-3">
                    <AgentCell name={r.name} avatarUrl={r.avatarUrl} rank={r.rank} />
                  </td>
                  <td className="py-2 pr-3 text-right text-brand-700">{formatInt(r.attempts)}</td>
                  <td className="py-2 pr-3 text-right text-brand-600">
                    {formatPercent(r.contactRate)}
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold text-brand-700">
                    {formatInt(r.appointments)}
                  </td>
                  <td className="py-2 pr-3 text-right text-brand-600">
                    {formatPercent(r.showRate)}
                  </td>
                  <td className="py-2 pr-3 text-right text-brand-600">
                    {formatMinutes(r.avgFirstContactMin)}
                  </td>
                  <td className="py-2 text-right text-brand-600">
                    {formatPercent(r.icpCompleteRate)}
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
