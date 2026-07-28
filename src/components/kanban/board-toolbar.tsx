'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { searchKanban } from '@/actions/kanban';
import type {
  AssignedFilter,
  BoardSort,
  KanbanLeadRow,
  InterestFilter,
  QualificationFilter,
} from '@/actions/leads-queries';
import { cn } from '@/lib/utils/cn';
import { useBoardSearchTerm } from './board-search-context';
import type { BoardDensity } from './use-board-density';
import type { SourceFilter } from '@/types/lead';
import type { PipelineKind } from '@/types/pipeline';

/** Estado da busca reportado ao board para filtrar os cards em tempo real. */
export interface BoardSearchState {
  /** Termo atual (já com trim). */
  term: string;
  /** Resultados da busca server-side; null quando não há busca ativa. */
  results: KanbanLeadRow[] | null;
  /** Busca em andamento (debounce/await). */
  searching: boolean;
}

interface BoardToolbarProps {
  pipeline: PipelineKind;
  /** Título do pipeline ativo (sub-header em linha única). */
  title: string;
  /** Total real de leads ativos no board (soma das colunas, com filtros). */
  totalCount: number;
  sort: BoardSort;
  interestFilter: InterestFilter;
  sourceFilter: SourceFilter;
  assignedFilter: AssignedFilter;
  qualificationFilter: QualificationFilter;
  isDemo: boolean;
  /** Densidade dos cards (Compacto | Confortável), persistida em localStorage. */
  density: BoardDensity;
  onDensityChange: (next: BoardDensity) => void;
  /** Reporta o estado da busca — o board filtra os cards das colunas em tempo real. */
  onSearch: (state: BoardSearchState) => void;
  /** Abre o modal de criação de lead direto no board. */
  onNewLead: () => void;
}

/**
 * Sub-header do board em linha única: título do pipeline + contador, toggle de
 * ordenação (Data/Score), densidade (Compacto/Confortável), busca e atalho
 * "Novo lead". A busca é server-side com debounce (300ms) e filtra os cards das
 * colunas EM TEMPO REAL (não um dropdown à parte), combinando com os filtros de
 * produto/fonte ativos — acha leads em qualquer coluna, inclusive os que ainda
 * não foram carregados pelas páginas das colunas.
 */
export function BoardToolbar({
  pipeline,
  title,
  totalCount,
  sort,
  interestFilter,
  sourceFilter,
  assignedFilter,
  qualificationFilter,
  isDemo,
  density,
  onDensityChange,
  onSearch,
  onNewLead,
}: BoardToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Termo compartilhado com a busca da barra de filtros (mesma busca do board);
  // fora do provider (board usado avulso) cai num estado local próprio.
  const shared = useBoardSearchTerm();
  const local = useState('');
  const [term, setTerm] = shared ?? local;
  const [, startTransition] = useTransition();

  function setSort(next: BoardSort) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (next === 'data') params.delete('sort');
    else params.set('sort', next);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // Busca com debounce (300ms). Reporta o estado ao board: <2 chars limpa o
  // filtro; ≥2 chars marca "buscando" na hora e, após o debounce, entrega os
  // resultados (já combinados com produto/fonte pela searchKanban).
  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) {
      onSearch({ term: t, results: null, searching: false });
      return;
    }
    onSearch({ term: t, results: null, searching: true });
    const handle = setTimeout(() => {
      startTransition(async () => {
        const rows = await searchKanban({
          pipeline,
          term: t,
          interestFilter,
          sourceFilter,
          assignedFilter,
          qualificationFilter,
          isDemo,
        });
        onSearch({ term: t, results: rows, searching: false });
      });
    }, 300);
    return () => clearTimeout(handle);
    // onSearch é um setState estável; demais deps reexecutam a busca ao mudar.
  }, [term, pipeline, interestFilter, sourceFilter, assignedFilter, qualificationFilter, isDemo, onSearch]);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-100 bg-white px-3 py-2 shadow-sm">
      <div className="mr-auto min-w-0">
        <div className="flex items-baseline gap-2">
          <h2 className="truncate text-base font-semibold leading-tight text-brand-700">{title}</h2>
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium tabular-nums text-brand-600">
            {totalCount.toLocaleString('pt-BR')}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-brand-400">
          {totalCount.toLocaleString('pt-BR')}{' '}
          {totalCount === 1 ? 'família em atendimento' : 'famílias em atendimento'}
        </p>
      </div>
      <div
        className="flex items-center gap-1 rounded-md border border-brand-200 bg-white p-0.5 text-xs"
        title="A coluna Novo Lead é sempre ordenada por data"
      >
        <span className="hidden px-1.5 text-brand-400 sm:inline">Ordenar:</span>
        <button
          type="button"
          onClick={() => setSort('data')}
          className={cn(
            'rounded px-2 py-1 font-medium transition-colors',
            sort === 'data' ? 'bg-brand-600 text-canvas' : 'text-brand-600 hover:bg-brand-50',
          )}
        >
          Data
        </button>
        <button
          type="button"
          onClick={() => setSort('score')}
          className={cn(
            'rounded px-2 py-1 font-medium transition-colors',
            sort === 'score' ? 'bg-brand-600 text-canvas' : 'text-brand-600 hover:bg-brand-50',
          )}
        >
          Score
        </button>
      </div>

      <div className="flex items-center gap-1 rounded-md border border-brand-200 bg-white p-0.5 text-xs">
        <button
          type="button"
          onClick={() => onDensityChange('compact')}
          title="Cards em linha única — mais leads por scroll"
          className={cn(
            'rounded px-2 py-1 font-medium transition-colors',
            density === 'compact' ? 'bg-brand-600 text-canvas' : 'text-brand-600 hover:bg-brand-50',
          )}
        >
          Compacto
        </button>
        <button
          type="button"
          onClick={() => onDensityChange('comfortable')}
          title="Cards completos, com botões e detalhes"
          className={cn(
            'rounded px-2 py-1 font-medium transition-colors',
            density === 'comfortable'
              ? 'bg-brand-600 text-canvas'
              : 'text-brand-600 hover:bg-brand-50',
          )}
        >
          Confortável
        </button>
      </div>

      <button
        type="button"
        onClick={onNewLead}
        className="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-canvas shadow-sm transition-colors hover:bg-brand-800"
      >
        + Nova família
      </button>
    </div>
  );
}
