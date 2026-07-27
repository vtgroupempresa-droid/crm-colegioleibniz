import { redirect } from 'next/navigation';
import {
  getPipelineBoardStats,
  getPipelineTabCounts,
  listAssignableUsers,
} from '@/actions/leads-queries';
import { BoardFilterBar } from '@/components/kanban/board-filter-bar';
import { BoardSearchProvider } from '@/components/kanban/board-search-context';
import { OportunidadesTabs } from '@/components/kanban/oportunidades-tabs';
import { PipelineGauges } from '@/components/kanban/pipeline-gauges';
import { PipelinePage } from '@/components/kanban/pipeline-page';
import { getSession } from '@/lib/auth/session';
import { INTEREST_LEVELS, parseSourceFilter } from '@/types/lead';
import { isPipelineKind, pipelinesForRole, type PipelineKind } from '@/types/pipeline';
import type { BoardSort } from '@/actions/leads-queries';

export const dynamic = 'force-dynamic';

/**
 * Funil de matrículas. O pipeline ativo vem da query string
 * (?pipeline=comercial); as abas trocam entre os pipelines visíveis.
 *
 * Dashboard de gauges contextual ao pipeline ativo + filtros de
 * Interesse/Fonte/Responsável em dropdowns compactos.
 */
export default async function OportunidadesPage(
  props: {
    searchParams: Promise<{
      pipeline?: string;
      interesse?: string;
      fonte?: string;
      responsavel?: string;
      sort?: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) redirect('/login');

  const allowed = pipelinesForRole(session.role);
  const requested = searchParams.pipeline;
  const active: PipelineKind =
    requested && isPipelineKind(requested) && allowed.includes(requested)
      ? requested
      : (allowed[0] ?? 'comercial');

  const assignableUsers = await listAssignableUsers();

  // Filtro de interesse (?interesse=none|baixo|medio|alto) — valor desconhecido
  // cai em 'all' (evita board vazio por URL velha).
  const requestedInterest = searchParams.interesse;
  const interestFilter =
    requestedInterest === 'none' ||
    (requestedInterest && (INTEREST_LEVELS as readonly string[]).includes(requestedInterest))
      ? (requestedInterest as string)
      : 'all';

  // Filtro de fonte (?fonte=pagas|organicas|<lead_source>) — inválido cai em 'all'.
  const sourceFilter = parseSourceFilter(searchParams.fonte);

  // Filtro de responsável (?responsavel=none|<uuid>) — segmenta por pessoa.
  // uuid desconhecido cai em 'all' (evita board vazio por URL velha).
  const requestedAssignee = searchParams.responsavel;
  const assignedFilter =
    requestedAssignee === 'none' || assignableUsers.some((u) => u.id === requestedAssignee)
      ? (requestedAssignee as string)
      : 'all';

  // Ordenação das colunas (?sort=score → interesse) — padrão 'data'.
  const sort: BoardSort = searchParams.sort === 'score' ? 'score' : 'data';

  const filterOpts = { interestFilter, sourceFilter, assignedFilter };
  const [stats, tabCounts] = await Promise.all([
    getPipelineBoardStats(active, filterOpts),
    getPipelineTabCounts(filterOpts),
  ]);

  return (
    // Sem h-full: a página rola (gauges e filtros sobem) e o board ocupa ~a tela toda.
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-2xl font-semibold text-brand-700">Funil</h2>
      </header>
      {/* key remonta os gauges ao trocar de aba — a animação do arco reinicia. */}
      <PipelineGauges
        key={active}
        pipeline={active}
        stats={stats}
        siblingCount={allowed.length - 1}
      />
      {/* Provider client: a busca da barra de filtros e a do sub-header do board
          controlam o MESMO termo (sobrevive à troca de aba/filtro). */}
      <BoardSearchProvider>
        <BoardFilterBar
          users={assignableUsers}
          interestFilter={interestFilter}
          sourceFilter={sourceFilter}
          assignedFilter={assignedFilter}
        />
        <OportunidadesTabs pipelines={allowed} active={active} counts={tabCounts} />
        {/* Board com altura ~viewport: ao rolar a página pra baixo, gauges e filtros
            saem de cena e o pipeline preenche a tela (mais leads visíveis por vez). */}
        <div className="h-[calc(100vh-5rem)] min-h-[26rem]">
          {/* key força o board a remontar ao trocar de pipeline/produto/fonte/ordenação */}
          <PipelinePage
            key={`${active}:${interestFilter}:${sourceFilter}:${assignedFilter}:${sort}`}
            pipeline={active}
            interestFilter={interestFilter}
            sourceFilter={sourceFilter}
            assignedFilter={assignedFilter}
            sort={sort}
          />
        </div>
      </BoardSearchProvider>
    </section>
  );
}
