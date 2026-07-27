'use server';

import { getSession } from '@/lib/auth/session';
import {
  getKanbanColumnPage,
  searchKanbanLeads,
  type AssignedFilter,
  type InterestFilter,
  type QualificationFilter,
  type BoardSort,
  type KanbanLeadRow,
} from './leads-queries';
import type { SourceFilter } from '@/types/lead';
import type { PipelineKind } from '@/types/pipeline';

/**
 * Server Actions do board chamadas pelo cliente: paginação por coluna
 * ("carregar mais") e busca no pipeline inteiro. Ambas exigem sessão e
 * delegam às queries server-only (que respeitam RLS).
 */

export interface LoadColumnArgs {
  pipeline: PipelineKind;
  stage: string;
  sort: BoardSort;
  offset: number;
  sourceFilter: SourceFilter;
  assignedFilter: AssignedFilter;
  interestFilter?: InterestFilter;
  qualificationFilter?: QualificationFilter;
  isDemo?: boolean;
}

export async function loadKanbanColumn(args: LoadColumnArgs): Promise<KanbanLeadRow[]> {
  const session = await getSession();
  if (!session) return [];
  return getKanbanColumnPage(args.pipeline, args.stage, {
    sort: args.sort,
    offset: args.offset,
    isDemo: args.isDemo,
    sourceFilter: args.sourceFilter,
    assignedFilter: args.assignedFilter,
    interestFilter: args.interestFilter,
    qualificationFilter: args.qualificationFilter,
  });
}

export interface SearchKanbanArgs {
  pipeline: PipelineKind;
  term: string;
  sourceFilter: SourceFilter;
  assignedFilter: AssignedFilter;
  interestFilter?: InterestFilter;
  qualificationFilter?: QualificationFilter;
  isDemo?: boolean;
}

export async function searchKanban(args: SearchKanbanArgs): Promise<KanbanLeadRow[]> {
  const session = await getSession();
  if (!session) return [];
  return searchKanbanLeads(args.pipeline, args.term, {
    isDemo: args.isDemo,
    sourceFilter: args.sourceFilter,
    assignedFilter: args.assignedFilter,
    interestFilter: args.interestFilter,
    qualificationFilter: args.qualificationFilter,
  });
}
