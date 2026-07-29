import { DEFAULT_AGING_THRESHOLD_DAYS, getPipelineForecastData } from '@/actions/pipeline-forecast';
import { AgingTable } from '@/components/dashboard/aging-table';
import { DashboardSubnav } from '@/components/dashboard/dashboard-subnav';
import { ForecastCards } from '@/components/dashboard/forecast-cards';
import { PeriodFilter } from '@/components/dashboard/period-filter';
import { VelocityChart } from '@/components/dashboard/velocity-chart';
import { WeightedPipelineSection } from '@/components/dashboard/weighted-pipeline-section';
import { parsePeriodParams, resolvePeriod } from '@/lib/dashboard/period';
import { getDemoMode } from '@/lib/demo/context';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Pipeline e Forecast (Categoria 3): pipeline ponderado por probabilidade,
 * velocity semanal, aging de oportunidades e previsão 30/60/90 dias.
 *
 * O pipeline ponderado e o aging são um RETRATO ATUAL (não dependem do período
 * selecionado); o filtro de período existe pela navegação consistente entre as
 * seções do dashboard.
 */
export default async function PipelineForecastPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const isDemo = getDemoMode();
  const { kind, from, to } = parsePeriodParams(searchParams);
  const period = resolvePeriod(kind, { from, to });

  const agingRaw = Number(Array.isArray(searchParams.aging) ? searchParams.aging[0] : searchParams.aging);
  const agingThresholdDays =
    Number.isFinite(agingRaw) && agingRaw > 0 ? Math.floor(agingRaw) : DEFAULT_AGING_THRESHOLD_DAYS;

  const data = await getPipelineForecastData({ isDemo, period, agingThresholdDays });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-400">Vendas e previsão</p>
          <h2 className="mt-1 text-2xl font-semibold text-brand-700">Saúde e previsão do funil</h2>
          <p className="mt-1 text-sm text-brand-500">
            Priorize o que pode fechar e identifique oportunidades que precisam de atenção.
          </p>
        </div>
        <PeriodFilter current={kind} from={from?.toString()} to={to?.toString()} />
      </header>

      <DashboardSubnav />

      <WeightedPipelineSection
        stages={data.stages}
        rawTotal={data.rawTotal}
        weightedTotal={data.weightedTotal}
        activeLeads={data.activeLeads}
        leadsWithoutValue={data.leadsWithoutValue}
      />

      <ForecastCards
        forecast={data.forecast}
        weightedTotal={data.weightedTotal}
        avgCycleDays={data.avgCycleDays}
        historicalConversion={data.historicalConversion}
      />

      <div className="grid gap-5 2xl:grid-cols-2">
        <VelocityChart weeks={data.velocity} />
        <AgingTable rows={data.aging} thresholdDays={data.agingThresholdDays} />
      </div>
    </div>
  );
}
