import { CircleGaugeCard } from '@/components/dashboard/circle-gauge-card';
import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatDays, formatInt } from '@/lib/dashboard/format';
import type { SalesCycleData } from '@/types/dashboard';

/**
 * Ciclo de matrícula: dias entre a 1ª visita presencial da família e a
 * assinatura da matrícula, em média geral e por nível de ensino.
 */
export function SalesCycleTable({ data }: { data: SalesCycleData }) {
  const csvRows: CsvCell[][] = data.byLevel.map((r) => [
    r.levelLabel,
    r.deals,
    formatDays(r.avgDays),
  ]);

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Ciclo de matrícula
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Da 1ª visita à matrícula assinada, para as matrículas do período.
          </p>
        </div>
        <ExportButton
          filename="ciclo-de-matricula"
          headers={['Nível de ensino', 'Matrículas', 'Ciclo médio (dias)']}
          rows={csvRows}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:max-w-xl sm:grid-cols-2">
        <CircleGaugeCard
          // Régua de 90 dias — ciclo maior que isso satura o anel.
          fraction={data.avgDays !== null ? Math.min(data.avgDays, 90) / 90 : 0}
          display={formatDays(data.avgDays)}
          color={data.avgDays !== null && data.avgDays > 45 ? 'amber' : 'green'}
          label="Ciclo médio"
          description="1ª visita → matrícula assinada"
        />
        <CircleGaugeCard
          fraction={data.deals > 0 ? 1 : 0}
          display={formatInt(data.deals)}
          color="blue"
          label="Matrículas medidas"
          description="Matrículas do período com visita registrada"
        />
      </div>

      {data.byLevel.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-brand-500">
              <tr>
                <th className="pb-2 pr-3">Nível de ensino</th>
                <th className="pb-2 pr-3 text-right">Matrículas</th>
                <th className="pb-2 text-right">Ciclo médio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {data.byLevel.map((r) => (
                <tr key={r.level ?? 'sem_nivel'}>
                  <td className="py-2 pr-3 text-brand-700">{r.levelLabel}</td>
                  <td className="py-2 pr-3 text-right text-brand-600">{formatInt(r.deals)}</td>
                  <td className="py-2 text-right font-semibold text-brand-700">
                    {formatDays(r.avgDays)}
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
