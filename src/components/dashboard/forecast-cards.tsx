import { GaugeCard } from '@/components/leads/gauge-card';
import { brlShort } from '@/components/dashboard/chart-theme';
import { formatDays, formatPercent } from '@/lib/dashboard/format';
import type { ForecastWindow } from '@/types/dashboard';

const WINDOW_COLORS = ['amber', 'blue', 'green'] as const;

/**
 * Previsão de receita 30/60/90 dias: pipeline ponderado × fator de janela pelo
 * ciclo médio de matrícula. Sempre apresentada como ESTIMATIVA. O arco de cada
 * gauge mostra quanto do pipeline ponderado total já "cabe" na janela.
 */
export function ForecastCards({
  forecast,
  weightedTotal,
  avgCycleDays,
  historicalConversion,
}: {
  forecast: ForecastWindow[];
  weightedTotal: number;
  avgCycleDays: number | null;
  historicalConversion: number | null;
}) {
  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
        Previsão de receita
      </h3>
      <p className="mt-0.5 text-xs text-brand-400">
        Pipeline ponderado × fator de janela (ciclo médio de{' '}
        {avgCycleDays !== null ? formatDays(avgCycleDays) : '— sem histórico'}
        {historicalConversion !== null
          ? ` · conversão histórica visita→matrícula de ${formatPercent(historicalConversion)} nos últimos 90 dias`
          : ''}
        ).
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {forecast.map((f, i) => (
          <GaugeCard
            key={f.days}
            value={f.estimated}
            max={Math.max(weightedTotal, 1)}
            color={WINDOW_COLORS[i] ?? 'blue'}
            label={`Próximos ${f.days} dias`}
            description="Estimativa sobre o pipeline ponderado"
            display={brlShort(f.estimated)}
            pill={{ text: 'estimativa', tone: 'neutral' }}
          />
        ))}
      </div>

      <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
        ⚠ Estimativa estatística baseada no pipeline atual e no histórico recente — não é um
        compromisso de receita.
      </p>
    </section>
  );
}
