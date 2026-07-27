import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ResolvedPeriod } from '@/lib/dashboard/period';
import type { PipelineKind } from '@/types/pipeline';
import { EDUCATION_LEVEL_LABELS } from '@/types/lead';
import type { EducationLevel } from '@/types/lead';

/**
 * Relatório exportável da base de leads (/relatorios, admin only).
 *
 * Uma linha por lead no período, com nível de ensino, etapa legível, valor da
 * matrícula (Σ contract_value das matrículas ativas do lead), atribuição Meta
 * (campanha/anúncio) e o responsável pelo lead / quem fechou a matrícula.
 */

/** Teto defensivo: além disso o export vira parcial (a UI avisa). */
export const RELATORIO_MAX_ROWS = 10_000;

export interface RelatorioRow {
  id: string;
  name: string;
  createdAt: string;
  educationLabel: string | null;
  stageLabel: string;
  pipeline: string;
  valorMatricula: number;
  campanha: string | null;
  anuncio: string | null;
  responsavelName: string | null;
  fechadoPorName: string | null;
}

export interface RelatorioResult {
  rows: RelatorioRow[];
  /** true se a base filtrada excedeu RELATORIO_MAX_ROWS e foi truncada. */
  truncated: boolean;
}

export interface RelatorioFilters {
  isDemo?: boolean;
  period: ResolvedPeriod;
  /** Slug do stage; exige `pipeline` junto (slug se repete entre pipelines). */
  stage?: string;
  pipeline?: string;
  /** Filtra pelo responsável do lead. */
  assignedTo?: string;
  /** Filtra por quem fechou a matrícula. */
  closedBy?: string;
  educationLevel?: EducationLevel;
}

export async function getRelatorioLeads(opts: RelatorioFilters): Promise<RelatorioResult> {
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;

  // 1. Leads no período. Filtros que cabem em SQL vão aqui; "quem fechou" é em
  //    JS porque cruza deals. Puxamos uma linha a mais que o teto para detectar
  //    truncamento.
  let query = supabase
    .from('leads')
    .select(
      'id, name, created_at, pipeline, stage, education_level, assigned_to, meta_campaign_name, meta_ad_name',
    )
    .eq('is_demo', isDemo)
    .gte('created_at', opts.period.start.toISOString())
    .lt('created_at', opts.period.end.toISOString());

  if (opts.pipeline) query = query.eq('pipeline', opts.pipeline as PipelineKind);
  if (opts.stage) query = query.eq('stage', opts.stage);
  if (opts.educationLevel) query = query.eq('education_level', opts.educationLevel);
  if (opts.assignedTo) query = query.eq('assigned_to', opts.assignedTo);

  const { data: leadsData } = await query
    .order('created_at', { ascending: false })
    .limit(RELATORIO_MAX_ROWS + 1);

  const leads = (leadsData ?? []) as {
    id: string;
    name: string;
    created_at: string;
    pipeline: string;
    stage: string;
    education_level: EducationLevel | null;
    assigned_to: string | null;
    meta_campaign_name: string | null;
    meta_ad_name: string | null;
  }[];

  if (leads.length === 0) return { rows: [], truncated: false };

  const leadIds = leads.map((l) => l.id);

  // 2. Lookups em lote (uma query cada).
  const [stagesRes, dealsRes] = await Promise.all([
    supabase.from('pipeline_stages').select('pipeline, slug, name'),
    supabase
      .from('deals')
      .select('id, lead_id, closed_by, contract_value, sale_status')
      .in('lead_id', leadIds),
  ]);

  // Etapa legível chaveada por `pipeline:slug` (slug repete entre pipelines).
  const stageName = new Map<string, string>();
  for (const s of stagesRes.data ?? []) stageName.set(`${s.pipeline}:${s.slug}`, s.name);

  const deals = ((dealsRes.data ?? []) as {
    id: string;
    lead_id: string;
    closed_by: string | null;
    contract_value: number;
    sale_status: string;
  }[]).filter((d) => d.sale_status !== 'cancelada');

  const dealByLead = new Map<string, (typeof deals)[number]>();
  const valorByLead = new Map<string, number>();
  for (const d of deals) {
    if (!dealByLead.has(d.lead_id)) dealByLead.set(d.lead_id, d);
    valorByLead.set(d.lead_id, (valorByLead.get(d.lead_id) ?? 0) + (d.contract_value ?? 0));
  }

  // 3. Nomes dos responsáveis e de quem fechou.
  const userIds = uniq([
    ...leads.map((l) => l.assigned_to),
    ...deals.map((d) => d.closed_by),
  ]);
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, name')
      .in('id', userIds);
    for (const p of profiles ?? []) nameById.set(p.id, p.name);
  }

  // 4. Monta as linhas.
  const allRows: RelatorioRow[] = leads.map((l) => {
    const deal = dealByLead.get(l.id);
    return {
      id: l.id,
      name: l.name,
      createdAt: l.created_at,
      educationLabel: l.education_level ? EDUCATION_LEVEL_LABELS[l.education_level] : null,
      stageLabel: stageName.get(`${l.pipeline}:${l.stage}`) ?? l.stage,
      pipeline: l.pipeline,
      valorMatricula: valorByLead.get(l.id) ?? 0,
      campanha: l.meta_campaign_name,
      anuncio: l.meta_ad_name,
      responsavelName: l.assigned_to ? (nameById.get(l.assigned_to) ?? null) : null,
      fechadoPorName: deal?.closed_by ? (nameById.get(deal.closed_by) ?? null) : null,
    };
  });

  // 5. Filtro "quem fechou" em JS (cruza deals).
  let rows = allRows;
  if (opts.closedBy) {
    rows = rows.filter((r) => dealByLead.get(r.id)?.closed_by === opts.closedBy);
  }

  const truncated = rows.length > RELATORIO_MAX_ROWS;
  return { rows: truncated ? rows.slice(0, RELATORIO_MAX_ROWS) : rows, truncated };
}

/** Ids únicos e não-nulos, em ordem de aparição. */
function uniq(ids: (string | null)[]): string[] {
  const seen = new Set<string>();
  for (const id of ids) if (id) seen.add(id);
  return Array.from(seen);
}
