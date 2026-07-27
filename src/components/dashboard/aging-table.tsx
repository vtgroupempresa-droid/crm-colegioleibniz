import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt } from '@/lib/dashboard/format';
import { formatBRL } from '@/lib/utils/format';
import type { AgingOpportunityRow } from '@/types/dashboard';

/**
 * Aging de oportunidades: leads parados na etapa atual há
 * mais tempo que o limiar — lista nominal com o atendente responsável.
 */
export function AgingTable({
  rows,
  thresholdDays,
}: {
  rows: AgingOpportunityRow[];
  thresholdDays: number;
}) {
  const csvRows: CsvCell[][] = rows.map((r) => [
    r.name,
    r.stageName,
    r.closerName ?? '—',
    r.daysInStage,
    r.estimatedValue !== null ? formatBRL(r.estimatedValue) : '—',
  ]);

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Aging — requer atenção
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Oportunidades paradas há {thresholdDays}+ dias no stage atual (ajuste com ?aging=N na
            URL).
          </p>
        </div>
        <ExportButton
          filename="aging-oportunidades"
          headers={['Lead', 'Etapa', 'Atendente', 'Dias parado', 'Valor estimado']}
          rows={csvRows}
        />
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-brand-400">
          Nenhuma oportunidade parada acima do limiar. 🎉
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-brand-500">
              <tr>
                <th className="pb-2 pr-3">Lead</th>
                <th className="pb-2 pr-3">Etapa</th>
                <th className="pb-2 pr-3">Atendente</th>
                <th className="pb-2 pr-3 text-right">Dias parado</th>
                <th className="pb-2 text-right">Valor estimado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {rows.map((r) => (
                <tr key={r.leadId}>
                  <td className="py-2 pr-3 font-medium text-brand-700">{r.name}</td>
                  <td className="py-2 pr-3 text-brand-600">{r.stageName}</td>
                  <td className="py-2 pr-3 text-brand-600">{r.closerName ?? '—'}</td>
                  <td className="py-2 pr-3 text-right">
                    <span
                      className={
                        r.daysInStage >= thresholdDays * 2
                          ? 'inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800'
                          : 'inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800'
                      }
                    >
                      {formatInt(r.daysInStage)}d
                    </span>
                  </td>
                  <td className="py-2 text-right text-brand-600">
                    {r.estimatedValue !== null ? formatBRL(r.estimatedValue) : '—'}
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
