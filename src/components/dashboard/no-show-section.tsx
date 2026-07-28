import { GaugeCard } from '@/components/leads/gauge-card';
import { AgentCell } from '@/components/dashboard/agent-cell';
import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt, formatPercent } from '@/lib/dashboard/format';
import type { AppointmentsSummary, NoShowByPersonRow } from '@/types/dashboard';

function PersonTable({ rows, dimension }: { rows: NoShowByPersonRow[]; dimension: string }) {
  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-brand-400">Sem agendamentos no período.</p>;
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-brand-500">
          <tr>
            <th className="pb-2 pr-3">{dimension}</th>
            <th className="pb-2 pr-3 text-right">Agendam.</th>
            <th className="pb-2 pr-3 text-right">No-shows</th>
            <th className="pb-2 text-right">Taxa no-show</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-100">
          {rows.map((r) => (
            <tr key={r.userId}>
              <td className="py-2 pr-3">
                <AgentCell name={r.name} avatarUrl={r.avatarUrl} />
              </td>
              <td className="py-2 pr-3 text-right text-brand-600">{formatInt(r.appointments)}</td>
              <td className="py-2 pr-3 text-right text-brand-600">{formatInt(r.noShows)}</td>
              <td className="py-2 text-right font-semibold text-brand-700">
                {formatPercent(r.noShowRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Agendamentos marcados vs realizados + taxa de no-show em destaque (métrica
 * crítica, frequentemente "escondida"). Segmentada por quem agendou
 * (problema de qualificação?) e por quem atendeu a visita (
 * problema de condução da confirmação?).
 */
export function NoShowSection({
  summary,
  bySdr,
  byCloser,
}: {
  summary: AppointmentsSummary;
  bySdr: NoShowByPersonRow[];
  byCloser: NoShowByPersonRow[];
}) {
  const noShowPct = summary.noShowRate !== null ? Math.round(summary.noShowRate * 100) : 0;
  const csvRows: CsvCell[][] = [
    ...bySdr.map((r): CsvCell[] => ['Quem agendou', r.name, r.appointments, r.noShows, formatPercent(r.noShowRate)]),
    ...byCloser.map((r): CsvCell[] => ['Quem atendeu', r.name, r.appointments, r.noShows, formatPercent(r.noShowRate)]),
  ];

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Agendamentos e no-show
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Marcados vs realizados no período. No-show = não compareceu ÷ agendamentos com
            desfecho conhecido.
          </p>
        </div>
        <ExportButton
          filename="no-show"
          headers={['Dimensão', 'Nome', 'Agendamentos', 'No-shows', 'Taxa']}
          rows={csvRows}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <GaugeCard
          value={summary.booked}
          max={Math.max(summary.booked, 1)}
          color="blue"
          label="Marcados"
          description="Agendamentos criados no período"
        />
        <GaugeCard
          value={summary.showed}
          max={Math.max(summary.booked, 1)}
          color="green"
          label="Realizados"
          description="Compareceram (showed_up)"
          pill={
            summary.showRate !== null
              ? { text: `${Math.round(summary.showRate * 100)}% show`, tone: 'up' }
              : undefined
          }
        />
        <GaugeCard
          value={noShowPct}
          max={100}
          color="red"
          label="Taxa de no-show"
          description="Não compareceu ÷ desfecho conhecido"
          display={formatPercent(summary.noShowRate)}
          pill={
            summary.noShowRate === null
              ? { text: 'sem desfechos', tone: 'neutral' }
              : summary.noShowRate > 0.3
                ? { text: '⚠ acima de 30%', tone: 'alert' }
                : { text: 'sob controle', tone: 'up' }
          }
        />
        <GaugeCard
          value={summary.resolved}
          max={Math.max(summary.booked, 1)}
          color="amber"
          label="Com desfecho"
          description="Agendamentos já resolvidos (show ou no-show)"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-brand-500">
            Por quem agendou
          </p>
          <PersonTable rows={bySdr} dimension="Quem agendou" />
        </div>
        <div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-brand-500">
            Por quem atendeu
          </p>
          <PersonTable rows={byCloser} dimension="Quem atendeu" />
        </div>
      </div>
    </section>
  );
}
