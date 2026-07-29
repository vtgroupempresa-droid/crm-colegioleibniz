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
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function parseGranularity(raw: string | string[] | undefined): TimeGranularity {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'day' || value === 'week' || value === 'month' ? value : 'week';
}

/**
 * Topo de Funil — geração e qualificação: leads por canal,
 * taxa de conexão, funil de qualificação, no-show, SLA de 1º contato e atividades.
 */
export default async function TopoFunilPage(props: PageProps) {
  const searchParams = await props.searchParams;
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
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-400">Captação</p>
          <h2 className="mt-1 text-2xl font-semibold text-brand-700">Leads e qualidade do atendimento</h2>
          <p className="mt-1 text-sm text-brand-500">
            Veja de onde os contatos chegam e se recebem o primeiro retorno no tempo certo.{' '}
            <span className="text-brand-400">· {data.periodLabel}</span>
          </p>
        </div>
        <PeriodFilter current={kind} from={from?.toString()} to={to?.toString()} />
      </header>

      <DashboardSubnav />

      <div className="grid gap-5 2xl:grid-cols-2">
        <LeadsByChannel
          buckets={data.buckets}
          channelTotals={data.channelTotals}
          granularity={data.granularity}
        />
        <ConversionFunnel
          stages={qualificationStages}
          title="Qualificação dos leads"
          subtitle="Interessados = interesse médio ou alto · Quentes = interesse alto ou visita marcada."
          filename="funil-qualificacao"
        />
      </div>

      <div className="grid gap-5 2xl:grid-cols-2">
        <FirstResponseSection
          avgMinutes={data.firstResponse.avgMinutes}
          under5MinRate={data.firstResponse.under5MinRate}
          rows={data.firstResponse.rows}
        />
        <NoShowSection
          summary={data.appointments}
          bySdr={data.noShowBySdr}
          byCloser={data.noShowByCloser}
        />
      </div>

      <details className="group rounded-xl border border-brand-100 bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-sm font-semibold text-brand-700 marker:hidden">
          <span>
            Acompanhar cadência e conexão da equipe
            <span className="mt-0.5 block text-xs font-normal text-brand-400">
              Taxas de contato, atividades e follow-ups por atendente.
            </span>
          </span>
          <span className="text-lg leading-none text-brand-400 transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="grid gap-5 border-t border-brand-100 p-4 2xl:grid-cols-2">
          <ConnectionRateTables byChannel={data.connectionByChannel} bySdr={data.connectionBySdr} />
          <SdrActivityTable rows={data.sdrActivity} />
        </div>
      </details>
    </div>
  );
}
