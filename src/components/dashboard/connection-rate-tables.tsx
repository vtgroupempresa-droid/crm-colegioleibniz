import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt, formatPercent } from '@/lib/dashboard/format';
import type { ConnectionRateRow } from '@/types/dashboard';

function RateTable({ rows, dimension }: { rows: ConnectionRateRow[]; dimension: string }) {
  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-brand-400">Sem tentativas no período.</p>;
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-brand-500">
          <tr>
            <th className="pb-2 pr-3">{dimension}</th>
            <th className="pb-2 pr-3 text-right">Tentativas</th>
            <th className="pb-2 pr-3 text-right">Conectou</th>
            <th className="pb-2 text-right">Taxa</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-100">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="py-2 pr-3 text-brand-700">{r.label}</td>
              <td className="py-2 pr-3 text-right text-brand-600">{formatInt(r.attempts)}</td>
              <td className="py-2 pr-3 text-right text-brand-600">{formatInt(r.connected)}</td>
              <td className="py-2 text-right font-semibold text-brand-700">
                {formatPercent(r.rate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Taxa de conexão (ligou → atendeu): tentativas com resposta/agendamento ÷
 * tentativas registradas, por canal e por atendente.
 */
export function ConnectionRateTables({
  byChannel,
  bySdr,
}: {
  byChannel: ConnectionRateRow[];
  bySdr: ConnectionRateRow[];
}) {
  const csvRows: CsvCell[][] = [
    ...byChannel.map((r): CsvCell[] => ['Canal', r.label, r.attempts, r.connected, formatPercent(r.rate)]),
    ...bySdr.map((r): CsvCell[] => ['Atendente', r.label, r.attempts, r.connected, formatPercent(r.rate)]),
  ];

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Taxa de conexão
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Tentativas em que o lead respondeu ou agendou ÷ tentativas registradas.
          </p>
        </div>
        <ExportButton
          filename="taxa-conexao"
          headers={['Dimensão', 'Nome', 'Tentativas', 'Conectou', 'Taxa']}
          rows={csvRows}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand-500">
            Por canal
          </p>
          <RateTable rows={byChannel} dimension="Canal" />
        </div>
        <div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand-500">
            Por atendente
          </p>
          <RateTable rows={bySdr} dimension="Atendente" />
        </div>
      </div>
    </section>
  );
}
