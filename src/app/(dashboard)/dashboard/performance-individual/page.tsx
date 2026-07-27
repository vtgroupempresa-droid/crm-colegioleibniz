import { getIndividualPerformance } from '@/actions/performance-individual';
import { ActivityConversionScatter } from '@/components/dashboard/activity-conversion-scatter';
import { DashboardSubnav } from '@/components/dashboard/dashboard-subnav';
import { PerformanceRankingTable } from '@/components/dashboard/performance-ranking-table';
import { PeriodFilter } from '@/components/dashboard/period-filter';
import { parsePeriodParams, resolvePeriod } from '@/lib/dashboard/period';
import { getDemoMode } from '@/lib/demo/context';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Performance Individual (Categoria 5): ranking por taxa de conversão (não só
 * volume), metas individuais e matriz de dispersão atividade × conversão.
 * Metas são cadastradas no /admin, seção "Metas individuais".
 */
export default async function PerformanceIndividualPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const isDemo = getDemoMode();
  const { kind, from, to } = parsePeriodParams(searchParams);
  const period = resolvePeriod(kind, { from, to });

  const { rows, goalMonthLabel } = await getIndividualPerformance({ isDemo, period });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-brand-700">Performance Individual</h2>
          <p className="mt-1 text-sm text-brand-500">
            Ranking e coaching — atividade, conversão e metas.{' '}
            <span className="text-brand-400">· {period.label}</span>
          </p>
        </div>
        <PeriodFilter current={kind} from={from?.toString()} to={to?.toString()} />
      </header>

      <DashboardSubnav />

      <PerformanceRankingTable rows={rows} goalMonthLabel={goalMonthLabel} />
      <ActivityConversionScatter rows={rows} />
    </div>
  );
}
