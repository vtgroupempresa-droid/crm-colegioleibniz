import { getTopoFunilData } from '@/actions/topo-funil-analytics';
import { ConnectionRateTables } from '@/components/dashboard/connection-rate-tables';
import { ConversionFunnel } from '@/components/dashboard/conversion-funnel';
import { DashboardSubnav } from '@/components/dashboard/dashboard-subnav';
import { FirstResponseSection } from '@/components/dashboard/first-response-section';
import { LeadsByChannel } from '@/components/dashboard/leads-by-channel';
import { NoShowSection } from '@/components/dashboard/no-show-section';
import { PeriodFilter } from '@/components/dashboard/period-filter';
import { SdrActivityTable } from '@/components/dashboard/sdr-activity-table';
import { parsePeriodParams, resolvePeriod } from '@/lib/dashboard/period';
import { getDemoMode } from '@/lib/demo/context';
import type { FunnelStage, TimeGranularity } from '@/types/dashboard';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

function parseGranularity(raw: string | string[] | undefined): TimeGranularity {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'day' || value === 'week' || value === 'month' ? value : 'week';
}

/**
 * Topo de Funil — geração e qualificação: leads por canal,
 * taxa de conexão, funil de qualificação, no-show, SLA de 1º contato e atividades.
 */
export default async function TopoFunilPage({ searchParams }: PageProps) {
  const isDemo = getDemoMode();
  const { kind, from, to } = parsePeriodParams(searchParams);
  const period = resolvePeriod(kind, { from, to });
  const granularity = parseGranularity(searchParams.gran);

  const data = await getTopoFunilData({ isDemo, period, granularity });

  const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);
  const q = data.qualification;
  const qualificationStages: FunnelStage[] = [
    { key: 'total', label: 'Total de leads', count: q.total, pctOfPrev: null, pctOfTop: ratio(q.total, q.total) },
    {
      key: 'interessados',
      label: 'Interessados (interesse médio ou alto)',
      count: q.interessados,
      pctOfPrev: ratio(q.interessados, q.total),
      pctOfTop: ratio(q.interessados, q.total),
    },
    {
      key: 'quentes',
      label: 'Quentes (interesse alto ou visita marcada)',
      count: q.quentes,
      pctOfPrev: ratio(q.quentes, q.interessados),
      pctOfTop: ratio(q.quentes, q.total),
    },
    {
      key: 'agendado',
      label: 'Visita agendada',
      count: q.agendado,
      pctOfPrev: ratio(q.agendado, q.quentes),
      pctOfTop: ratio(q.agendado, q.total),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-brand-700">Topo de Funil</h2>
          <p className="mt-1 text-sm text-brand-500">
            Geração e qualificação do atendimento.{' '}
            <span className="text-brand-400">· {data.periodLabel}</span>
          </p>
        </div>
        <PeriodFilter current={kind} from={from?.toString()} to={to?.toString()} />
      </header>

      <DashboardSubnav />

      <LeadsByChannel
        buckets={data.buckets}
        channelTotals={data.channelTotals}
        granularity={data.granularity}
      />

      <ConversionFunnel
        stages={qualificationStages}
        title="Funil de qualificação"
        subtitle="Interessados = interesse médio ou alto · Quentes = interesse alto ou visita já marcada."
        filename="funil-qualificacao"
      />

      <NoShowSection
        summary={data.appointments}
        bySdr={data.noShowBySdr}
        byCloser={data.noShowByCloser}
      />

      <ConnectionRateTables byChannel={data.connectionByChannel} bySdr={data.connectionBySdr} />

      <FirstResponseSection
        avgMinutes={data.firstResponse.avgMinutes}
        under5MinRate={data.firstResponse.under5MinRate}
        rows={data.firstResponse.rows}
      />

      <SdrActivityTable rows={data.sdrActivity} />
    </div>
  );
}
