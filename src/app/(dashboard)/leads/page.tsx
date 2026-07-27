import {
  getAllActivePipelineStages,
  getLeadsPageStats,
  listLeads,
} from '@/actions/leads-queries';
import { LeadsTable } from '@/components/leads/leads-table';
import { getDemoMode } from '@/lib/demo/context';
import { isPeriodKind, resolvePeriod } from '@/lib/dashboard/period';
import { isPipelineKind, type PipelineKind } from '@/types/pipeline';
import {
  EDUCATION_LEVELS,
  INTEREST_LEVELS,
  LEAD_SOURCES,
  type EducationLevel,
  type InterestLevel,
  type LeadSource,
} from '@/types/lead';

export const dynamic = 'force-dynamic';

interface SearchParams {
  search?: string;
  pipeline?: string;
  stage?: string;
  educationLevel?: string;
  source?: string;
  interest?: string;
  sortBy?: string;
  sortDir?: string;
  page?: string;
  // Filtro por período de criação do lead (mesmo vocabulário do Dashboard)
  period?: string;
  from?: string;
  to?: string;
  // Chips de atalho rápido (flags '1')
  unassigned?: string;
  sla?: string;
  meetingToday?: string;
  newToday?: string;
}

function parsePipeline(raw?: string): PipelineKind | undefined {
  return raw && isPipelineKind(raw) ? raw : undefined;
}
function parseEducationLevel(raw?: string): EducationLevel | undefined {
  return raw && (EDUCATION_LEVELS as readonly string[]).includes(raw)
    ? (raw as EducationLevel)
    : undefined;
}
function parseInterest(raw?: string): InterestLevel | undefined {
  return raw && (INTEREST_LEVELS as readonly string[]).includes(raw)
    ? (raw as InterestLevel)
    : undefined;
}
function parseSource(raw?: string): LeadSource | undefined {
  return raw && (LEAD_SOURCES as readonly string[]).includes(raw)
    ? (raw as LeadSource)
    : undefined;
}
function parseSort(raw?: string): 'created_at' | 'updated_at' | 'last_entered_at' {
  if (raw === 'updated_at' || raw === 'last_entered_at') return raw;
  return 'created_at';
}

/**
 * Converte o período da URL (?period=&from=&to=) na janela de created_at.
 * `end` do resolvePeriod é exclusivo; subtraímos 1ms porque listLeads usa lte.
 */
function parseCreatedWindow(searchParams: SearchParams): {
  createdFrom?: string;
  createdTo?: string;
} {
  if (!searchParams.period || !isPeriodKind(searchParams.period)) return {};
  const period = resolvePeriod(searchParams.period, {
    from: searchParams.from,
    to: searchParams.to,
  });
  return {
    createdFrom: period.start.toISOString(),
    createdTo: new Date(period.end.getTime() - 1).toISOString(),
  };
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const isDemo = getDemoMode();
  const createdWindow = parseCreatedWindow(searchParams);
  const [result, stats, stagesByPipeline] = await Promise.all([
    listLeads({
      isDemo,
      search: searchParams.search,
      ...createdWindow,
      pipeline: parsePipeline(searchParams.pipeline),
      stage: searchParams.stage,
      educationLevel: parseEducationLevel(searchParams.educationLevel),
      source: parseSource(searchParams.source),
      interestLevel: parseInterest(searchParams.interest),
      sortBy: parseSort(searchParams.sortBy),
      sortDir: searchParams.sortDir === 'asc' ? 'asc' : 'desc',
      page: searchParams.page ? Number(searchParams.page) : 1,
      unassigned: searchParams.unassigned === '1',
      slaBreached: searchParams.sla === '1',
      meetingToday: searchParams.meetingToday === '1',
      createdToday: searchParams.newToday === '1',
    }),
    getLeadsPageStats({ isDemo }),
    getAllActivePipelineStages(),
  ]);

  // Nome amigável de cada stage ("primeiro_contato" → "Primeiro Contato"),
  // chaveado por `${pipeline}:${slug}` para a cadeia visual da tabela.
  const stageLabels: Record<string, string> = {};
  for (const [pipeline, stages] of Object.entries(stagesByPipeline)) {
    for (const stage of stages) {
      stageLabels[`${pipeline}:${stage.slug}`] = stage.name;
    }
  }

  return (
    <LeadsTable
      leads={result.leads}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      stats={stats}
      stageLabels={stageLabels}
    />
  );
}
