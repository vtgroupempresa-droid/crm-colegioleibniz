import { AgentCell } from '@/components/dashboard/agent-cell';
import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt, formatPercent } from '@/lib/dashboard/format';
import type { SdrActivityRow } from '@/types/dashboard';

/**
 * Atividades por atendente: tentativas hoje/na semana/no período, follow-ups
 * (tentativa 2+), agendamentos e cadência cumprida (% das tentativas do
 * período registradas sem estourar o SLA da cadência 1→8).
 */
export function SdrActivityTable({ rows }: { rows: SdrActivityRow[] }) {
  const headers = [
    'Atendente',
    'Tentativas hoje',
    'Tentativas na semana',
    'Tentativas no período',
    'Follow-ups',
    'Agendamentos',
    'Cadência cumprida',
  ];
  const csvRows: CsvCell[][] = rows.map((r) => [
    r.name,
    r.attemptsToday,
    r.attemptsWeek,
    r.attemptsPeriod,
    r.followUps,
    r.appointments,
    formatPercent(r.cadenceRate),
  ]);

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Atividades por atendente
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Cadência cumprida = tentativas registradas dentro do SLA de follow-up (1→8).
          </p>
        </div>
        <ExportButton filename="atividades-equipe" headers={headers} rows={csvRows} />
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-brand-400">Sem atividades registradas.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-brand-500">
              <tr>
                <th className="pb-2 pr-3">Atendente</th>
                <th className="pb-2 pr-3 text-right">Hoje</th>
                <th className="pb-2 pr-3 text-right">Semana</th>
                <th className="pb-2 pr-3 text-right">Período</th>
                <th className="pb-2 pr-3 text-right">Follow-ups</th>
                <th className="pb-2 pr-3 text-right">Agendam.</th>
                <th className="pb-2 text-right">Cadência</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {rows.map((r) => {
                const cadenceTone =
                  r.cadenceRate === null
                    ? 'text-brand-400'
                    : r.cadenceRate >= 0.8
                      ? 'text-emerald-700'
                      : 'text-amber-700';
                return (
                  <tr key={r.userId}>
                    <td className="py-2 pr-3">
                      <AgentCell name={r.name} avatarUrl={r.avatarUrl} />
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-brand-700">
                      {formatInt(r.attemptsToday)}
                    </td>
                    <td className="py-2 pr-3 text-right text-brand-600">
                      {formatInt(r.attemptsWeek)}
                    </td>
                    <td className="py-2 pr-3 text-right text-brand-600">
                      {formatInt(r.attemptsPeriod)}
                    </td>
                    <td className="py-2 pr-3 text-right text-brand-600">{formatInt(r.followUps)}</td>
                    <td className="py-2 pr-3 text-right text-brand-600">
                      {formatInt(r.appointments)}
                    </td>
                    <td className={`py-2 text-right font-semibold ${cadenceTone}`}>
                      {formatPercent(r.cadenceRate)}
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
