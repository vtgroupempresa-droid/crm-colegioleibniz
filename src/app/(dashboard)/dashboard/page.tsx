import { getDashboardData } from '@/actions/dashboard-analytics';
import { ConversionFunnel } from '@/components/dashboard/conversion-funnel';
import { DashboardSubnav } from '@/components/dashboard/dashboard-subnav';
import { HighInterestSection } from '@/components/dashboard/high-interest-section';
import { KpiGrid } from '@/components/dashboard/kpi-grid';
import { PeriodFilter } from '@/components/dashboard/period-filter';
import { parsePeriodParams, resolvePeriod } from '@/lib/dashboard/period';
import { getDemoMode } from '@/lib/demo/context';

export const dynamic = 'force-dynamic';

interface DashboardPageProps {
  // Next valida que `searchParams` aceita o índice padrão — manter a assinatura ampla.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Visão geral para decisão diária. Os relatórios de equipe, previsão, fontes e
 * demais recortes ficam nas abas específicas, sem competir com a operação.
 */
export default async function DashboardPage(props: DashboardPageProps) {
  const searchParams = await props.searchParams;
  const isDemo = getDemoMode();
  const { kind, from, to } = parsePeriodParams(searchParams);
  const period = resolvePeriod(kind, { from, to });

  const data = await getDashboardData({ isDemo, period });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-400">Visão geral</p>
          <h2 className="mt-1 text-2xl font-semibold text-brand-700">Acompanhe o que importa hoje</h2>
          <p className="mt-1 text-sm text-brand-500">
            Resultado, prioridades e avanço das matrículas.{' '}
            <span className="text-brand-400">{data.periodLabel} · {isDemo ? 'Demonstração' : 'Dados reais'}</span>
          </p>
        </div>
        <PeriodFilter current={kind} from={from?.toString()} to={to?.toString()} />
      </header>

      <DashboardSubnav />

      <KpiGrid macro={data.macro} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)] xl:items-start">
        <HighInterestSection data={data.highInterest} />
        <ConversionFunnel
          stages={data.funnel}
          subtitle="Veja em qual etapa as famílias estão avançando — e onde a equipe deve agir."
        />
      </div>
    </div>
  );
}
