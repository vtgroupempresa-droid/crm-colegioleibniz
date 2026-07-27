import {
  getAllActivePipelineStages,
  getKanbanColumnCounts,
  getKanbanColumnPage,
  getStagesForPipeline,
  KANBAN_PAGE_SIZE,
  type AssignedFilter,
  type BoardSort,
  type InterestFilter,
} from '@/actions/leads-queries';
import { KanbanBoard } from '@/components/kanban/kanban-board';
import type { SourceFilter } from '@/types/lead';
import { PIPELINE_LABELS, type PipelineKind } from '@/types/pipeline';

interface PipelinePageProps {
  pipeline: PipelineKind;
  isDemo?: boolean;
  /** Filtro de nível de interesse: 'all' | 'none' | 'baixo' | 'medio' | 'alto'. */
  interestFilter?: InterestFilter;
  /** Filtro de fonte: 'all' | 'pagas' | 'organicas' | LeadSource. */
  sourceFilter?: SourceFilter;
  /** Filtro de responsável: 'all' | 'none' | uuid do usuário. */
  assignedFilter?: AssignedFilter;
  /** Ordenação das colunas (Novo Lead é sempre por data). */
  sort?: BoardSort;
}

/**
 * Wrapper do board de um pipeline. Busca stages e leads no servidor
 * (respeitando RLS) e entrega ao KanbanBoard.
 *
 * Carregamento POR COLUNA: cada coluna traz só a primeira página (mais recentes
 * ou maior interesse) + a contagem real no cabeçalho. O "carregar mais" e a
 * busca vêm sob demanda via Server Actions — assim o board nunca trunca em
 * 1.000 nem trava o navegador com milhares de cards.
 *
 * Com `isDemo=true`, opera exclusivamente sobre rows com `is_demo=true`.
 */
export async function PipelinePage({
  pipeline,
  isDemo = false,
  interestFilter = 'all',
  sourceFilter = 'all',
  assignedFilter = 'all',
  sort = 'data',
}: PipelinePageProps) {
  const stages = await getStagesForPipeline(pipeline);
  const slugs = stages.map((s) => s.slug);
  const filterOpts = { isDemo, interestFilter, sourceFilter, assignedFilter };

  const [counts, pages, stagesByPipeline] = await Promise.all([
    getKanbanColumnCounts(pipeline, slugs, filterOpts),
    Promise.all(
      stages.map((s) =>
        getKanbanColumnPage(pipeline, s.slug, { ...filterOpts, sort, offset: 0, limit: KANBAN_PAGE_SIZE }),
      ),
    ),
    getAllActivePipelineStages(),
  ]);

  const initialEntries = pages.flat();
  const total = Object.values(counts).reduce((acc, n) => acc + n, 0);

  return (
    // Título + contador viraram parte da toolbar do board (sub-header em linha
    // única) — o KanbanBoard recebe boardTitle/totalCount e renderiza tudo junto.
    <section className="flex h-full flex-col">
      <div className="flex-1 min-h-0">
        <KanbanBoard
          pipeline={pipeline}
          boardTitle={PIPELINE_LABELS[pipeline]}
          totalCount={total}
          stages={stages}
          counts={counts}
          initialEntries={initialEntries}
          sort={sort}
          isDemo={isDemo}
          interestFilter={interestFilter}
          sourceFilter={sourceFilter}
          assignedFilter={assignedFilter}
          stagesByPipeline={stagesByPipeline}
        />
      </div>
    </section>
  );
}
