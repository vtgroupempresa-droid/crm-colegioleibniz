import Link from 'next/link';
import { getLeadsAudit } from '@/actions/leads-detalhado';
import { DashboardSubnav } from '@/components/dashboard/dashboard-subnav';
import { LeadsAuditFilters } from '@/components/dashboard/leads-audit-filters';
import { PeriodFilter } from '@/components/dashboard/period-filter';
import { formatInt } from '@/lib/dashboard/format';
import { formatDateTime } from '@/lib/utils/format';
import { parsePeriodParams, resolvePeriod } from '@/lib/dashboard/period';
import { getDemoMode } from '@/lib/demo/context';
import {
  INTEREST_LEVEL_LABELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  type InterestLevel,
  type LeadSource,
} from '@/types/lead';
import { PIPELINE_LABELS, isPipelineKind } from '@/types/pipeline';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function firstParam(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw) ?? '';
}

const INTEREST_TONE: Record<InterestLevel, string> = {
  alto: 'bg-red-100 text-red-800',
  medio: 'bg-amber-100 text-amber-800',
  baixo: 'bg-brand-100 text-brand-500',
};

/**
 * Rastreio lead a lead (Categoria 1): auditoria individual de qualquer lead,
 * com busca, período e canal — os filtros padronizados do sistema.
 */
export default async function LeadsDetalhadoPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const isDemo = getDemoMode();
  const { kind, from, to } = parsePeriodParams(searchParams);
  const period = resolvePeriod(kind, { from, to });

  const search = firstParam(searchParams.q);
  const canalRaw = firstParam(searchParams.canal);
  const source = (LEAD_SOURCES as readonly string[]).includes(canalRaw)
    ? (canalRaw as LeadSource)
    : undefined;
  const page = Math.max(1, Number(firstParam(searchParams.page)) || 1);

  const result = await getLeadsAudit({ isDemo, period, search: search || undefined, source, page });
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  // Links de paginação preservam todos os filtros atuais.
  const pageHref = (p: number): string => {
    const params = new URLSearchParams();
    params.set('period', kind);
    if (from) params.set('from', String(from));
    if (to) params.set('to', String(to));
    if (search) params.set('q', search);
    if (source) params.set('canal', source);
    params.set('page', String(p));
    return `/dashboard/leads-detalhado?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-brand-700">Leads Detalhado</h2>
          <p className="mt-1 text-sm text-brand-500">
            Rastreio lead a lead — {formatInt(result.total)} lead{result.total === 1 ? '' : 's'} no
            período. <span className="text-brand-400">· {period.label}</span>
          </p>
        </div>
        <PeriodFilter current={kind} from={from?.toString()} to={to?.toString()} />
      </header>

      <DashboardSubnav />

      <section className="rounded-lg border border-brand-100 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Auditoria individual
          </h3>
          <LeadsAuditFilters search={search} source={source ?? ''} />
        </div>

        {result.rows.length === 0 ? (
          <p className="mt-3 text-sm text-brand-400">Nenhum lead encontrado com esses filtros.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-brand-500">
                <tr>
                  <th className="pb-2 pr-3">Nome</th>
                  <th className="pb-2 pr-3">Canal</th>
                  <th className="pb-2 pr-3">Entrada</th>
                  <th className="pb-2 pr-3">Pipeline / Stage</th>
                  <th className="pb-2 pr-3 text-right">Interesse</th>
                  <th className="pb-2">Responsável</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100">
                {result.rows.map((lead) => (
                  <tr key={lead.id}>
                    <td className="py-2 pr-3 font-medium text-brand-700">{lead.name}</td>
                    <td className="py-2 pr-3 text-brand-600">
                      {lead.source ? LEAD_SOURCE_LABELS[lead.source] : '—'}
                      {lead.channelDetail && (
                        <span className="block max-w-52 truncate text-xs text-brand-400">
                          {lead.channelDetail}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-brand-600">{formatDateTime(lead.createdAt)}</td>
                    <td className="py-2 pr-3 text-brand-600">
                      {isPipelineKind(lead.pipeline) ? PIPELINE_LABELS[lead.pipeline] : lead.pipeline}
                      <span className="ml-1 text-xs text-brand-400">· {lead.stage}</span>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {lead.interestLevel ? (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${INTEREST_TONE[lead.interestLevel]}`}
                        >
                          {INTEREST_LEVEL_LABELS[lead.interestLevel]}
                        </span>
                      ) : (
                        <span className="text-xs text-brand-300">—</span>
                      )}
                    </td>
                    <td className="py-2 text-brand-600">{lead.assignedName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-brand-500">
            <span>
              Página {result.page} de {totalPages}
            </span>
            <div className="flex gap-2">
              {result.page > 1 && (
                <Link
                  href={pageHref(result.page - 1)}
                  className="rounded-md border border-brand-200 px-3 py-1 hover:bg-brand-50"
                >
                  ← Anterior
                </Link>
              )}
              {result.page < totalPages && (
                <Link
                  href={pageHref(result.page + 1)}
                  className="rounded-md border border-brand-200 px-3 py-1 hover:bg-brand-50"
                >
                  Próxima →
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
