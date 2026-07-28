import { ExportButton } from '@/components/dashboard/export-button';
import { GaugeCard } from '@/components/leads/gauge-card';
import { brlShort } from '@/components/dashboard/chart-theme';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt, formatPercent } from '@/lib/dashboard/format';
import { formatBRL } from '@/lib/utils/format';
import type { WeightedPipelineStageRow } from '@/types/dashboard';

/**
 * Pipeline ponderado vs bruto. Valor estimado = anuidade prevista do lead;
 * ponderação = probabilidade de fechamento do stage (configurável no /admin).
 */
export function WeightedPipelineSection({
  stages,
  rawTotal,
  weightedTotal,
  activeLeads,
  leadsWithoutValue,
}: {
  stages: WeightedPipelineStageRow[];
  rawTotal: number;
  weightedTotal: number;
  activeLeads: number;
  leadsWithoutValue: number;
}) {
  const csvRows: CsvCell[][] = stages.map((s) => [
    s.name,
    formatPercent(s.probability),
    s.leads,
    formatBRL(s.rawValue),
    formatBRL(s.weightedValue),
  ]);

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Pipeline ponderado
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Valor estimado (anuidade prevista) × probabilidade de fechamento da etapa.
          </p>
        </div>
        <ExportButton
          filename="pipeline-ponderado"
          headers={['Stage', 'Probabilidade', 'Leads', 'Pipeline bruto', 'Pipeline ponderado']}
          rows={csvRows}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <GaugeCard
          value={weightedTotal}
          max={Math.max(rawTotal, 1)}
          color="blue"
          label="Pipeline ponderado"
          description="Σ valor × probabilidade do stage"
          display={brlShort(weightedTotal)}
          pill={{
            text: `${formatPercent(rawTotal > 0 ? weightedTotal / rawTotal : null)} do bruto`,
            tone: 'neutral',
          }}
        />
        <GaugeCard
          value={rawTotal}
          max={Math.max(rawTotal, 1)}
          color="purple"
          label="Pipeline bruto"
          description="Σ valor estimado, sem ponderação"
          display={brlShort(rawTotal)}
        />
        <GaugeCard
          value={activeLeads}
          max={Math.max(activeLeads, 1)}
          color="green"
          label="Oportunidades ativas"
          description="Leads em etapa não-terminal do funil"
          pill={
            leadsWithoutValue > 0
              ? { text: `${formatInt(leadsWithoutValue)} sem valor estimado (fora da soma)`, tone: 'warn' }
              : { text: 'todas com valor estimado', tone: 'up' }
          }
        />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-brand-500">
            <tr>
              <th className="pb-2 pr-3">Stage</th>
              <th className="pb-2 pr-3 text-right">Probabilidade</th>
              <th className="pb-2 pr-3 text-right">Leads</th>
              <th className="pb-2 pr-3 text-right">Bruto</th>
              <th className="pb-2 text-right">Ponderado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100">
            {stages.map((s) => (
              <tr key={s.slug}>
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-2 text-brand-700">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: s.color }}
                      aria-hidden
                    />
                    {s.name}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right text-brand-600">
                  {formatPercent(s.probability)}
                </td>
                <td className="py-2 pr-3 text-right text-brand-600">{formatInt(s.leads)}</td>
                <td className="py-2 pr-3 text-right text-brand-600">{formatBRL(s.rawValue)}</td>
                <td className="py-2 text-right font-semibold text-brand-700">
                  {formatBRL(s.weightedValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-brand-400">
        As probabilidades por stage são editáveis no /admin, seção Pipelines.
      </p>
    </section>
  );
}
