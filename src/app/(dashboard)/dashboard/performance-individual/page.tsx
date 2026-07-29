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
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-400">Equipe</p>
          <h2 className="mt-1 text-2xl font-semibold text-brand-700">Resultados da equipe</h2>
          <p className="mt-1 text-sm text-brand-500">
            Leitura clara de atividade, conversão e metas para orientar a gestão.{' '}
            <span className="text-brand-400">· {period.label}</span>
          </p>
        </div>
        <PeriodFilter current={kind} from={from?.toString()} to={to?.toString()} />
      </header>

      <DashboardSubnav />

      <PerformanceRankingTable rows={rows} goalMonthLabel={goalMonthLabel} />

      <details className="group rounded-xl border border-brand-100 bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-sm font-semibold text-brand-700 marker:hidden">
          <span>
            Abrir análise de atividade × conversão
            <span className="mt-0.5 block text-xs font-normal text-brand-400">
              Use no coaching para comparar volume de ação e resultado por pessoa.
            </span>
          </span>
          <span className="text-lg leading-none text-brand-400 transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="border-t border-brand-100 p-4">
          <ActivityConversionScatter rows={rows} />
        </div>
      </details>
    </div>
  );
}
