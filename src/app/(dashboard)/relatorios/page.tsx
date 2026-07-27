import { redirect } from 'next/navigation';
import { getRelatorioLeads } from '@/actions/relatorios';
import { getAllActivePipelineStages, listAssignableUsers } from '@/actions/leads-queries';
import { getSession, isAdmin } from '@/lib/auth/session';
import { getDemoMode } from '@/lib/demo/context';
import { parsePeriodParams, resolvePeriod } from '@/lib/dashboard/period';
import { PIPELINES } from '@/types/pipeline';
import { EDUCATION_LEVELS, type EducationLevel } from '@/types/lead';
import { formatBRL, formatDate } from '@/lib/utils/format';
import { formatInt } from '@/lib/dashboard/format';
import { PeriodFilter } from '@/components/dashboard/period-filter';
import {
  RelatorioFilters,
  type RelatorioStageGroup,
} from '@/components/relatorios/relatorio-filters';
import { RelatorioExport } from '@/components/relatorios/relatorio-export';

export const dynamic = 'force-dynamic';

const PREVIEW_LIMIT = 100;

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

function firstParam(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw) ?? '';
}

/**
 * Relatório exportável da base de leads (admin only). Filtros por etapa do
 * funil, período, nível de ensino, responsável e quem fechou a matrícula;
 * exporta em CSV a base filtrada inteira.
 */
export default async function RelatoriosPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdmin(session.role)) redirect('/');

  const isDemo = getDemoMode();
  const { kind, from, to } = parsePeriodParams(searchParams);
  const period = resolvePeriod(kind, { from, to });

  const pipeline = firstParam(searchParams.pipeline);
  const stage = firstParam(searchParams.stage);
  const assignedTo = firstParam(searchParams.responsavel);
  const closedBy = firstParam(searchParams.fechadoPor);
  const ensinoRaw = firstParam(searchParams.ensino);
  // Nível desconhecido na URL cai em "todos" — evita relatório vazio por link velho.
  const educationLevel = (EDUCATION_LEVELS as readonly string[]).includes(ensinoRaw)
    ? (ensinoRaw as EducationLevel)
    : undefined;

  const [stagesByPipeline, team, result] = await Promise.all([
    getAllActivePipelineStages(),
    listAssignableUsers(),
    getRelatorioLeads({
      isDemo,
      period,
      pipeline: pipeline || undefined,
      stage: stage || undefined,
      assignedTo: assignedTo || undefined,
      closedBy: closedBy || undefined,
      educationLevel,
    }),
  ]);

  // Etapas na ordem canônica dos pipelines, para o dropdown agrupado.
  const stageGroups: RelatorioStageGroup[] = PIPELINES.map((p) => ({
    pipeline: p as string,
    stages: stagesByPipeline[p] ?? [],
  })).filter((g) => g.stages.length > 0);

  const teamOptions = team.map((u) => ({ id: u.id, name: u.name }));

  const stageValue = pipeline && stage ? `${pipeline}:${stage}` : '';
  const total = result.rows.length;
  const preview = result.rows.slice(0, PREVIEW_LIMIT);
  const filename = `relatorio-leads-${period.start.toISOString().slice(0, 10)}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-brand-700">Relatórios</h2>
          <p className="mt-1 text-sm text-brand-500">
            Exportação da base de leads — {formatInt(total)} lead{total === 1 ? '' : 's'} no filtro.
            <span className="text-brand-400"> · {period.label}</span>
          </p>
        </div>
        <PeriodFilter current={kind} from={from} to={to} />
      </header>

      <section className="rounded-lg border border-brand-100 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <RelatorioFilters
            stageValue={stageValue}
            assignedTo={assignedTo}
            closedBy={closedBy}
            educationLevel={educationLevel ?? ''}
            stageGroups={stageGroups}
            team={teamOptions}
          />
          <RelatorioExport rows={result.rows} filename={filename} />
        </div>

        {result.truncated && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            O filtro retornou mais de {formatInt(total)} leads — a exportação foi limitada a esse
            teto. Refine o período ou os filtros para uma base completa.
          </p>
        )}

        {total === 0 ? (
          <p className="mt-3 text-sm text-brand-400">Nenhum lead encontrado com esses filtros.</p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-brand-500">
                  <tr>
                    <th className="pb-2 pr-3">Entrada</th>
                    <th className="pb-2 pr-3">Nome</th>
                    <th className="pb-2 pr-3">Nível de ensino</th>
                    <th className="pb-2 pr-3">Etapa</th>
                    <th className="pb-2 pr-3 text-right">Valor da matrícula</th>
                    <th className="pb-2 pr-3">Campanha</th>
                    <th className="pb-2">Anúncio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100">
                  {preview.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3 text-brand-600">{formatDate(r.createdAt)}</td>
                      <td className="py-2 pr-3 font-medium text-brand-700">{r.name}</td>
                      <td className="py-2 pr-3 text-brand-600">{r.educationLabel ?? '—'}</td>
                      <td className="py-2 pr-3 text-brand-600">{r.stageLabel}</td>
                      <td className="py-2 pr-3 text-right text-brand-700">
                        {r.valorMatricula > 0 ? formatBRL(r.valorMatricula) : '—'}
                      </td>
                      <td className="max-w-52 truncate py-2 pr-3 text-brand-500">
                        {r.campanha ?? '—'}
                      </td>
                      <td className="max-w-52 truncate py-2 text-brand-500">{r.anuncio ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > PREVIEW_LIMIT && (
              <p className="mt-3 text-xs text-brand-400">
                Mostrando os primeiros {PREVIEW_LIMIT} de {formatInt(total)} leads. Exporte o CSV
                para a lista completa.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
