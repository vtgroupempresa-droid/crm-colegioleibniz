import { getDashboardData } from '@/actions/dashboard-analytics';
import { ConversionFunnel } from '@/components/dashboard/conversion-funnel';
import { CloserTable } from '@/components/dashboard/closer-table';
import { DashboardSubnav } from '@/components/dashboard/dashboard-subnav';
import { EducationLevelTable } from '@/components/dashboard/education-level-table';
import { HighInterestSection } from '@/components/dashboard/high-interest-section';
import { KpiGrid } from '@/components/dashboard/kpi-grid';
import { LostReasonsSection } from '@/components/dashboard/lost-reasons-section';
import { PeriodFilter } from '@/components/dashboard/period-filter';
import { SalesCycleTable } from '@/components/dashboard/sales-cycle-table';
import { SdrTable } from '@/components/dashboard/sdr-table';
import { parsePeriodParams, resolvePeriod } from '@/lib/dashboard/period';
import { getDemoMode } from '@/lib/demo/context';

export const dynamic = 'force-dynamic';

interface DashboardPageProps {
  // Next valida que `searchParams` aceita o índice padrão — manter a assinatura ampla.
  searchParams: { [key: string]: string | string[] | undefined };
}

/**
 * Dashboard executivo. Filtro de período global via searchParams: a página é
 * Server Component e refaz todas as queries quando o período muda.
 *
 * Destaques pedidos na reunião com o colégio: matrículas fechadas e o
 * cruzamento "interesse alto × não fechou matrícula".
 */
export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const isDemo = getDemoMode();
  const { kind, from, to } = parsePeriodParams(searchParams);
  const period = resolvePeriod(kind, { from, to });

  const data = await getDashboardData({ isDemo, period });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-brand-700">Dashboard</h2>
          <p className="mt-1 text-sm text-brand-500">
            Visão comercial completa. {isDemo ? 'Dados de demonstração.' : 'Dados reais.'}{' '}
            <span className="text-brand-400">· {data.periodLabel}</span>
          </p>
        </div>
        <PeriodFilter current={kind} from={from?.toString()} to={to?.toString()} />
      </header>

      <DashboardSubnav />

      <KpiGrid macro={data.macro} />
      <HighInterestSection data={data.highInterest} />
      <ConversionFunnel stages={data.funnel} />
      <SdrTable rows={data.sdr} />
      <CloserTable rows={data.closers} />

      <ConversionFunnel
        stages={data.closerFunnel}
        title="Funil de fechamento"
        subtitle="Visitas agendadas → Compareceram → Em negociação → Matrícula fechada, com taxa de passagem por etapa."
        filename="funil-fechamento"
      />
      <SalesCycleTable data={data.salesCycle} />
      <LostReasonsSection items={data.lostReasons} />

      <EducationLevelTable rows={data.educationLevels} />
    </div>
  );
}
