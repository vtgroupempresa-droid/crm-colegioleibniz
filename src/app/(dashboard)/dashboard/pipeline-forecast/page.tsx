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
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-brand-700">Pipeline &amp; Forecast</h2>
          <p className="mt-1 text-sm text-brand-500">
            Retrato atual do funil, ponderado por probabilidade de fechamento.
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

      <VelocityChart weeks={data.velocity} />

      <AgingTable rows={data.aging} thresholdDays={data.agingThresholdDays} />
    </div>
  );
}
